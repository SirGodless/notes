import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { isInputActive } from '../ink/inputActivity';
import { PointerRouter } from '../ink/pointerRouter';
import { createIslandManifest, type IslandManifest } from '../model/island';
import type { Stroke } from '../model/types';
import {
  ETagConflictError,
  fetchIsland,
  fetchTree,
  putIsland,
} from '../storage/workspaceApi';
import { IslandView } from './IslandView';
import { resolveOwner, type IslandHitNode } from './ownership';
import { PanZoomController, type SceneTransform } from './PanZoomController';
import { SceneProvider, type SceneContextValue } from './SceneContext';
import { initialSceneToolState, type SceneToolState } from './sceneToolState';
import { Toolbar } from './Toolbar';

/** Wartezeit nach der letzten Aenderung einer Insel, bevor sie gespeichert wird. */
const SAVE_DEBOUNCE_MS = 1200;
/** Wie oft waehrend eines laufenden Strichs nachgeschaut wird, ob gespeichert werden darf. */
const RETRY_WHILE_DRAWING_MS = 250;

interface LoadedIsland {
  /** Das VOLLE Manifest – siehe IslandView.tsx fuer die Begruendung. */
  manifest: IslandManifest;
  etag: string;
  dirty: boolean;
}

/**
 * Die oberste Komponente der v2-Szene: ein unendliches, pan-/zoombares Meer
 * mit den Top-Level-Inseln aus dem Arbeitsbereich.
 *
 * Stage B bewusst ohne Verschachtelung (nur Top-Level-Inseln, siehe Plan)
 * und ohne Kuestenlinie (Inseln sind feste Rechtecke – Stage C ersetzt das).
 */
export function SeaView() {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const worldRef = useRef<HTMLDivElement | null>(null);

  const [islands, setIslands] = useState<Map<string, LoadedIsland>>(new Map());
  const [loadError, setLoadError] = useState<string | null>(null);
  // Fuer den Lesezugriff aus dem debounced-Save-Timer (siehe scheduleSave) –
  // dort wollen wir den AKTUELLEN Stand lesen, ohne dafuer selbst ein
  // setIslands(() => ...) auszuloesen.
  const islandsRef = useRef(islands);
  islandsRef.current = islands;

  const toolRef = useRef<SceneToolState>(initialSceneToolState);
  const [tool, setTool] = useState<SceneToolState>(initialSceneToolState);
  const updateTool = useCallback((patch: Partial<SceneToolState>) => {
    setTool((current) => {
      const next = { ...current, ...patch };
      toolRef.current = next;
      return next;
    });
  }, []);

  const router = useRef(new PointerRouter()).current;
  useEffect(() => () => router.dispose(), [router]);

  // -- Pan/Zoom --------------------------------------------------------------

  const resyncCallbacks = useRef(new Map<string, () => void>());
  const resyncScheduled = useRef(false);

  const scheduleResync = useCallback(() => {
    if (resyncScheduled.current) return;
    resyncScheduled.current = true;
    requestAnimationFrame(() => {
      resyncScheduled.current = false;
      for (const callback of resyncCallbacks.current.values()) callback();
    });
  }, []);

  const applyTransform = useCallback((transform: SceneTransform) => {
    const world = worldRef.current;
    if (world) {
      world.style.transform = `translate(${transform.x}px, ${transform.y}px) scale(${transform.zoom})`;
    }
  }, []);

  const panZoom = useRef<PanZoomController | null>(null);
  if (!panZoom.current) {
    panZoom.current = new PanZoomController((transform) => {
      applyTransform(transform);
      scheduleResync();
    });
  }

  useEffect(() => {
    applyTransform(panZoom.current!.getTransform());
    scheduleResync();
  }, [applyTransform, scheduleResync]);

  // Ownership-Registry fuer ueberlappende Inseln (siehe scene/ownership.ts).
  // Jede Insel meldet sich mit einem Kuestenlinien-Test an; der zentrale
  // Dispatcher unten (onScenePointerDownCapture) entscheidet bei jedem
  // pointerdown, welche Insel gewinnt, BEVOR irgendeine Insel ihren eigenen
  // pointerdown-Handler sieht (Inseln registrieren dafuer absichtlich
  // KEINEN eigenen pointerdown-Listener mehr, siehe IslandView.tsx).
  const hitNodes = useRef(new Map<string, IslandHitNode>());

  const sceneValue = useMemo<SceneContextValue>(
    () => ({
      getTransform: () => panZoom.current!.getTransform(),
      getViewportElement: () => viewportRef.current,
      registerResync: (id, fn) => resyncCallbacks.current.set(id, fn),
      unregisterResync: (id) => resyncCallbacks.current.delete(id),
      registerIslandHitNode: (node) => hitNodes.current.set(node.id, node),
      unregisterIslandHitNode: (id) => hitNodes.current.delete(id),
    }),
    [],
  );

  // Zentrale Ownership-Aufloesung: native Capture-Phase-Listener auf dem
  // Viewport (Ancestor aller Inseln), damit er VOR jedem Insel-eigenen
  // Capture-Listener (move/up/cancel, siehe IslandView) feuert. Findet er
  // eine Insel, delegiert er direkt an deren handlePointerDown – das
  // ruft preventDefault()/stopPropagation() bei Bedarf selbst auf, wodurch
  // der Bubble-Phase-Pan-Handler unten das Event gar nicht erst sieht.
  // Trifft keine Insel zu (offenes Wasser oder ausserhalb der Kuestenlinie,
  // auch wenn die rechteckige Bounding-Box noch ueberlappt), bleibt das
  // Event unangetastet und erreicht normal den Pan-Handler.
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const handleSceneDown = (event: PointerEvent) => {
      const winner = resolveOwner([...hitNodes.current.values()], event.clientX, event.clientY);
      winner?.handlePointerDown(event);
    };

    viewport.addEventListener('pointerdown', handleSceneDown, { capture: true });
    return () => viewport.removeEventListener('pointerdown', handleSceneDown, { capture: true });
  }, []);

  const onViewportPointerDown = useCallback((event: React.PointerEvent) => {
    // Nur Events, die KEINE Insel schon per stopPropagation() beansprucht
    // hat, erreichen diesen Bubble-Phase-Handler ueberhaupt (siehe
    // PanZoomController-Kommentar) – alles, was hier ankommt, pannt.
    (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
    panZoom.current!.handlePointerDown(event.nativeEvent);
  }, []);
  const onViewportPointerMove = useCallback((event: React.PointerEvent) => {
    panZoom.current!.handlePointerMove(event.nativeEvent);
  }, []);
  const onViewportPointerUp = useCallback((event: React.PointerEvent) => {
    panZoom.current!.handlePointerUp(event.nativeEvent);
  }, []);
  const onViewportPointerCancel = useCallback((event: React.PointerEvent) => {
    panZoom.current!.handlePointerCancel(event.nativeEvent);
  }, []);

  // Kein JSX onWheel: React haengt Wheel-Handler aus Scroll-Performance-
  // Gruenden standardmaessig PASSIV ein, event.preventDefault() wuerde dort
  // stillschweigend ignoriert (Browser-Warnung "Unable to preventDefault
  // inside passive event listener invocation") und der Browser koennte
  // zusaetzlich eigenmaechtig scrollen/zoomen. Deshalb ein nativer Listener
  // mit { passive: false }.
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = viewport.getBoundingClientRect();
      const factor = Math.exp(-event.deltaY * 0.001);
      panZoom.current!.zoomAt(event.clientX - rect.left, event.clientY - rect.top, factor);
    };

    viewport.addEventListener('wheel', handleWheel, { passive: false });
    return () => viewport.removeEventListener('wheel', handleWheel);
  }, []);

  // -- Laden -------------------------------------------------------------

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const tree = await fetchTree();
        if (cancelled) return;

        const loaded = new Map<string, LoadedIsland>();
        for (const child of tree.children) {
          const { manifest, etag } = await fetchIsland([child.id]);
          if (cancelled) return;
          loaded.set(child.id, { manifest, etag, dirty: false });
        }
        setIslands(loaded);
      } catch (error) {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : String(error));
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  // -- Insel anlegen (Platzhalter-UI fuer Stage B; Stage D macht das ueber Tippen in offenem Wasser) --

  const addIsland = useCallback(async () => {
    const transform = panZoom.current!.getTransform();
    const viewport = viewportRef.current?.getBoundingClientRect();
    // Grob in der Bildschirmmitte platzieren.
    const screenCenterX = viewport ? viewport.width / 2 : 400;
    const screenCenterY = viewport ? viewport.height / 2 : 300;
    const worldX = (screenCenterX - transform.x) / transform.zoom;
    const worldY = (screenCenterY - transform.y) / transform.zoom;

    const manifest = createIslandManifest({
      name: `Insel ${islandsRef.current.size + 1}`,
      x: Math.round(worldX),
      y: Math.round(worldY),
      layers: [{ id: crypto.randomUUID(), name: 'Ebene 1', visible: true, order: 0, strokes: [] }],
    });

    const etag = await putIsland([manifest.id], manifest);
    setIslands((current) => {
      const next = new Map(current);
      next.set(manifest.id, { manifest, etag, dirty: false });
      return next;
    });
  }, []);

  // -- Striche entgegennehmen + debounced speichern -----------------------

  const saveTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const scheduleSave = useCallback((islandId: string) => {
    const existing = saveTimers.current.get(islandId);
    if (existing) clearTimeout(existing);

    const attempt = async () => {
      if (isInputActive()) {
        saveTimers.current.set(islandId, setTimeout(() => void attempt(), RETRY_WHILE_DRAWING_MS));
        return;
      }
      saveTimers.current.delete(islandId);

      const entry = islandsRef.current.get(islandId);
      if (!entry || !entry.dirty) return;

      try {
        const newEtag = await putIsland([islandId], entry.manifest, entry.etag);
        setIslands((latest) => {
          const current = latest.get(islandId);
          // Nur zuruecksetzen, wenn zwischenzeitlich nichts Neues dazukam –
          // sonst wuerde ein waehrend des Speicherns begonnener Strich faelschlich als "gespeichert" markiert.
          if (!current || current.manifest !== entry.manifest) return latest;
          const next = new Map(latest);
          next.set(islandId, { ...current, etag: newEtag, dirty: false });
          return next;
        });
      } catch (error) {
        if (error instanceof ETagConflictError) {
          // Stage B: Konflikt nur sichtbar machen, kein Merge-UI noetig
          // (Einzelnutzer, zwei Geraete – siehe Plan).
          console.warn('Speicherkonflikt bei Insel', islandId, error.current);
        } else {
          console.error('Insel konnte nicht gespeichert werden:', error);
        }
      }
    };

    saveTimers.current.set(islandId, setTimeout(() => void attempt(), SAVE_DEBOUNCE_MS));
  }, []);

  useEffect(() => {
    const timers = saveTimers.current;
    return () => {
      for (const timer of timers.values()) clearTimeout(timer);
    };
  }, []);

  // "Zuletzt beruehrt liegt oben" (siehe ownership.ts): bei jedem pointerdown
  // auf einer Insel deren z ueber das aller Geschwister heben. Separat von
  // handleStrokeCommitted, weil auch ein Strich, der am Ende verworfen wird
  // (z.B. reine Palm-Rejection-Beruehrung zaehlt nicht, die kommt nie bis
  // hierher – aber ein abgebrochener Radierstrich schon), die Insel sichtbar
  // nach oben bringen soll.
  const bumpIslandZ = useCallback((islandId: string) => {
    setIslands((current) => {
      const entry = current.get(islandId);
      if (!entry) return current;

      const othersMaxZ = Math.max(
        -Infinity,
        ...[...current.values()].filter((e) => e.manifest.id !== islandId).map((e) => e.manifest.z),
      );
      if (entry.manifest.z > othersMaxZ) return current; // bereits eindeutig oben, nichts zu tun

      const next = new Map(current);
      next.set(islandId, { ...entry, manifest: { ...entry.manifest, z: othersMaxZ + 1 }, dirty: true });
      return next;
    });
    scheduleSave(islandId);
  }, [scheduleSave]);

  const handleStrokeCommitted = useCallback(
    (islandId: string) => (layerId: string, stroke: Stroke) => {
      setIslands((current) => {
        const entry = current.get(islandId);
        if (!entry) return current;

        const layers = entry.manifest.layers.map((layer) =>
          layer.id === layerId ? { ...layer, strokes: [...layer.strokes, stroke] } : layer,
        );

        const next = new Map(current);
        next.set(islandId, { ...entry, manifest: { ...entry.manifest, layers }, dirty: true });
        return next;
      });
      scheduleSave(islandId);
    },
    [scheduleSave],
  );

  return (
    <SceneProvider value={sceneValue}>
      <div className="sea-app">
        <Toolbar tool={tool} updateTool={updateTool} onAddIsland={() => void addIsland()} />

        {loadError && <div className="sea-error">Arbeitsbereich konnte nicht geladen werden: {loadError}</div>}

        <div
          ref={viewportRef}
          className="sea-viewport"
          onPointerDown={onViewportPointerDown}
          onPointerMove={onViewportPointerMove}
          onPointerUp={onViewportPointerUp}
          onPointerCancel={onViewportPointerCancel}
        >
          <div ref={worldRef} className="sea-world" style={{ transform: 'translate(0px, 0px) scale(1)' }}>
            {[...islands.values()].map((entry) => (
              <IslandBinding
                key={entry.manifest.id}
                manifest={entry.manifest}
                toolRef={toolRef}
                router={router}
                onStrokeCommittedFactory={handleStrokeCommitted}
                onTouchedFactory={bumpIslandZ}
              />
            ))}
          </div>
        </div>
      </div>
    </SceneProvider>
  );
}

/** Bindet onStrokeCommitted/onTouched pro Insel stabil, damit IslandView.memo() greift. */
function IslandBinding({
  manifest,
  toolRef,
  router,
  onStrokeCommittedFactory,
  onTouchedFactory,
}: {
  manifest: IslandManifest;
  toolRef: React.RefObject<SceneToolState>;
  router: PointerRouter;
  onStrokeCommittedFactory: (islandId: string) => (layerId: string, stroke: Stroke) => void;
  onTouchedFactory: (islandId: string) => void;
}) {
  const handler = useMemo(() => onStrokeCommittedFactory(manifest.id), [onStrokeCommittedFactory, manifest.id]);
  const onTouched = useCallback(() => onTouchedFactory(manifest.id), [onTouchedFactory, manifest.id]);
  return (
    <IslandView island={manifest} toolRef={toolRef} router={router} onStrokeCommitted={handler} onTouched={onTouched} />
  );
}
