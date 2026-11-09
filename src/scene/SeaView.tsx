import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { isInputActive } from '../ink/inputActivity';
import { PointerRouter } from '../ink/pointerRouter';
import { createIslandManifest, createTextBox, type IslandManifest, type TextBox } from '../model/island';
import type { Stroke, TextDoc } from '../model/types';
import {
  ETagConflictError,
  fetchIsland,
  fetchTree,
  flagIslandForDeletion,
  moveIsland,
  putIsland,
  unflagIslandForDeletion,
  type IdPath,
  type TreeNode,
} from '../storage/workspaceApi';
import { applyGridRhythm } from './applyGridRhythm';
import { IslandView } from './IslandView';
import { resolveOwner, resolveOwnerExcluding, type IslandHitNode } from './ownership';
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
  /**
   * Volle ID-Kette inkl. der Insel selbst (siehe storage/workspaceApi.ts
   * IdPath) – seit Stage E (Verschachtelung) kann das mehr als ein Element
   * haben. Bestimmt sowohl den API-Pfad als auch (ueber die Laenge minus 2)
   * die Eltern-Insel.
   */
  idPath: IdPath;
}

// ---------------------------------------------------------------------------
// Reine Hilfsfunktionen auf der Insel-Map (ausserhalb der Komponente, damit
// sie sich isoliert testen/lesen lassen und die Komponente nicht zusaetzlich
// aufblaehen).
// ---------------------------------------------------------------------------

/** Globale ("Welt"-)Position der Insel/des Knotens an idPath, als Summe der x/y aller Glieder der Kette. */
function globalPositionOf(idPath: IdPath, islands: Map<string, LoadedIsland>): { x: number; y: number } {
  let x = 0;
  let y = 0;
  for (const id of idPath) {
    const entry = islands.get(id);
    if (!entry) break;
    x += entry.manifest.x;
    y += entry.manifest.y;
  }
  return { x, y };
}

/**
 * Haengt eine Insel (und rekursiv alle ihre Nachfahren) unter einen neuen
 * Eltern-Pfad um – fuer Center-Drop (Kind werden) UND fuer das Zurueckhaengen
 * von Kind-Inseln beim Rand-Merge (siehe store.ts ACHTUNG-Kommentar).
 * Nachfahren behalten ihre eigene x/y (die sind relativ zum JEWEILS EIGENEN
 * Elternteil und damit von der Umbenennung des Pfad-Praefixes unberuehrt);
 * nur die verschobene Insel selbst bekommt neue x/y.
 */
function reparentSubtree(
  islands: Map<string, LoadedIsland>,
  movedId: string,
  newParentIdPath: IdPath,
  newX: number,
  newY: number,
  /**
   * Der von moveIsland() zurueckgegebene NEUE ETag der verschobenen Insel
   * (siehe workspaceApi.moveIsland-Doku) – OHNE das wuerde der naechste
   * eigene PUT dieser Insel mit dem veralteten ETag einen falschen
   * 409-Konflikt auslösen, obwohl niemand sonst etwas geaendert hat.
   */
  newEtag?: string,
): Map<string, LoadedIsland> {
  const moved = islands.get(movedId);
  if (!moved) return islands;
  const oldIdPath = moved.idPath;
  const newIdPath = [...newParentIdPath, movedId];

  const next = new Map(islands);
  for (const entry of islands.values()) {
    if (entry.idPath.length < oldIdPath.length) continue;
    const prefix = entry.idPath.slice(0, oldIdPath.length);
    if (prefix.join('/') !== oldIdPath.join('/')) continue;

    const suffix = entry.idPath.slice(oldIdPath.length);
    const updatedIdPath = [...newIdPath, ...suffix];
    const isMovedItself = suffix.length === 0;
    next.set(entry.manifest.id, {
      ...entry,
      idPath: updatedIdPath,
      manifest: isMovedItself ? { ...entry.manifest, x: newX, y: newY } : entry.manifest,
      etag: isMovedItself && newEtag ? newEtag : entry.etag,
      // Nur die verschobene Insel selbst ist durch moveIsland() frisch
      // gespeichert (siehe oben) – Nachfahren sind inhaltlich unberuehrt,
      // ihr dirty-Status bleibt also wie er war (ein eventuell noch
      // ungespeicherter Tastendruck darf hier nicht verschluckt werden).
      dirty: isMovedItself ? false : entry.dirty,
    });
  }
  return next;
}

/** Direkte Kinder von idPath (leer = Wurzel/Top-Level-Inseln). */
function directChildrenOf(islands: Map<string, LoadedIsland>, parentIdPath: IdPath): LoadedIsland[] {
  return [...islands.values()].filter(
    (entry) => entry.idPath.length === parentIdPath.length + 1 && entry.idPath.slice(0, -1).join('/') === parentIdPath.join('/'),
  );
}

/** thumbnailStale propagiert den Baum hoch (siehe Plan, Abschnitt "Miniatur-Cache"). */
function propagateThumbnailStale(
  islands: Map<string, LoadedIsland>,
  idPath: IdPath,
  scheduleSave: (id: string) => void,
): Map<string, LoadedIsland> {
  if (idPath.length <= 1) return islands;
  const next = new Map(islands);
  for (let i = idPath.length - 2; i >= 0; i--) {
    const ancestorId = idPath[i];
    const entry = next.get(ancestorId);
    if (!entry || entry.manifest.thumbnailStale) continue;
    next.set(ancestorId, { ...entry, manifest: { ...entry.manifest, thumbnailStale: true }, dirty: true });
    scheduleSave(ancestorId);
  }
  return next;
}

// ---------------------------------------------------------------------------
// Minimales Undo fuer Stage E (siehe Plan: "Merge ist per Strg+Z rueckgaengig").
// Bewusst NICHT das v1-History-System (src/history/) wiederverwendet – das
// ist um ein einzelnes Dokument mit Seiten gebaut, nicht um asynchron
// gespeicherte, frei verschachtelte Inseln. Ein einfacher, SeaView-lokaler
// Einzelschritt-Stack reicht fuer das, was Stage E tatsaechlich verlangt
// (den letzten Layout- oder Merge-Schritt zuruecknehmen) – Ink-/Text-Undo
// bleibt ausserhalb dieser Stufe (siehe Taskliste, war in keiner frueheren
// Stufe Teil der Verifikationskriterien).
// ---------------------------------------------------------------------------

interface LayoutUndoEntry {
  type: 'layout';
  islandId: string;
  fromParentIdPath: IdPath;
  fromX: number;
  fromY: number;
}

interface MergeUndoEntry {
  type: 'merge';
  sourceId: string;
  sourceIdPath: IdPath;
  sourceManifestBefore: IslandManifest;
  targetId: string;
  targetIdPath: IdPath;
  targetManifestBefore: IslandManifest;
  /** Kind-Inseln von source, die beim Merge VOR dem Flaggen zu target umgehaengt wurden (siehe store.ts). */
  childMoves: { id: string; fromParentIdPath: IdPath; fromX: number; fromY: number }[];
}

type UndoEntry = LayoutUndoEntry | MergeUndoEntry;

/**
 * Die oberste Komponente der v2-Szene: ein unendliches, pan-/zoombares Meer
 * mit allen Inseln des Arbeitsbereichs – seit Stage E auch rekursiv
 * verschachtelt (siehe IslandView.tsx, das seine eigenen Kinder selbst
 * rendert).
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

  // Einmalig: Grundlinienraster-Werte (siehe baselineGrid.ts) als CSS Custom
  // Properties auf :root setzen, bevor irgendeine Textbox sie braucht.
  useEffect(() => {
    applyGridRhythm();
  }, []);

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
  // Dispatcher unten (handleSceneDown) entscheidet bei jedem pointerdown,
  // welche Insel gewinnt, BEVOR irgendeine Insel ihren eigenen
  // pointerdown-Handler sieht (Inseln registrieren dafuer absichtlich
  // KEINEN eigenen pointerdown-Listener mehr, siehe IslandView.tsx).
  const hitNodes = useRef(new Map<string, IslandHitNode>());

  // Insel-ID -> Textbox-ID, fuer genau EINEN Frame gesetzt, wenn ein Klick
  // in offenes Meer eine brandneue Insel mit ihrer ersten Textbox erzeugt
  // (siehe createIslandWithTextBox) – IslandView liest das einmalig als
  // Startwert eines Refs ein (siehe initialAutofocusTextBoxId-Prop), damit
  // die neue Textbox sofort den Cursor bekommt, ohne zweiten Klick.
  const pendingIslandFocusRef = useRef(new Map<string, string>());

  const saveTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  /** Schreibt den aktuellen Stand einer Insel, falls dirty. Kern von scheduleSave UND flushSave. */
  const performSave = useCallback(async (islandId: string) => {
    const entry = islandsRef.current.get(islandId);
    if (!entry || !entry.dirty) return;

    try {
      const newEtag = await putIsland(entry.idPath, entry.manifest, entry.etag);
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
        // Einzelnutzer, zwei Geraete (siehe Plan) – Konflikt nur sichtbar machen, kein Merge-UI noetig.
        console.warn('Speicherkonflikt bei Insel', islandId, error.current);
      } else {
        console.error('Insel konnte nicht gespeichert werden:', error);
      }
    }
  }, []);

  const scheduleSave = useCallback((islandId: string) => {
    const existing = saveTimers.current.get(islandId);
    if (existing) clearTimeout(existing);

    const attempt = async () => {
      if (isInputActive()) {
        saveTimers.current.set(islandId, setTimeout(() => void attempt(), RETRY_WHILE_DRAWING_MS));
        return;
      }
      saveTimers.current.delete(islandId);
      await performSave(islandId);
    };

    saveTimers.current.set(islandId, setTimeout(() => void attempt(), SAVE_DEBOUNCE_MS));
  }, [performSave]);

  /**
   * Erzwingt ein SOFORTIGES Speichern (keine Debounce-Wartezeit) – noetig vor
   * jedem moveIsland()-Aufruf (siehe Drag&Drop unten): store.move() liest auf
   * dem Server die AKTUELL AUF DISK stehende Fassung und schreibt sie (nur
   * mit neuer x/y) zurueck. Haette die Insel gerade noch ungespeicherte
   * Aenderungen (z.B. frisch getippter Text, Debounce-Fenster noch offen),
   * wuerden die von move() unsichtbar verworfen – und der dann irgendwann
   * doch noch feuernde alte Save-Timer wuerde zu allem Ueberfluss mit einem
   * inzwischen veralteten ETag auflaufen (409). flushSave schliesst dieses
   * Zeitfenster, indem der Stand VOR move()/putIsland() garantiert auf der
   * Platte landet.
   */
  const flushSave = useCallback(async (islandId: string) => {
    const timer = saveTimers.current.get(islandId);
    if (timer) {
      clearTimeout(timer);
      saveTimers.current.delete(islandId);
    }
    await performSave(islandId);
  }, [performSave]);

  useEffect(() => {
    const timers = saveTimers.current;
    return () => {
      for (const timer of timers.values()) clearTimeout(timer);
    };
  }, []);

  /**
   * Klick in offenes Wasser (keine Insel unter dem Zeiger, siehe
   * handleSceneDown) legt eine neue Insel mit einer einzelnen Textbox an der
   * angeklickten Weltposition an – siehe Plan, Abschnitt "Textboxen":
   * "In offenem Wasser ... erzeugt eine neue Textbox automatisch eine neue
   * Insel."
   */
  const createIslandWithTextBox = useCallback(async (worldX: number, worldY: number) => {
    const textBox = createTextBox({ x: 0, y: 0 });
    const manifest = createIslandManifest({
      name: `Insel ${islandsRef.current.size + 1}`,
      x: Math.round(worldX),
      y: Math.round(worldY),
      textBoxes: [textBox],
    });

    pendingIslandFocusRef.current.set(manifest.id, textBox.id);
    const etag = await putIsland([manifest.id], manifest);
    setIslands((current) => {
      const next = new Map(current);
      next.set(manifest.id, { manifest, etag, dirty: false, idPath: [manifest.id] });
      return next;
    });
  }, []);

  // -- Insel anlegen (Platzhalter-UI; Stage D macht das normalerweise ueber Tippen in offenem Wasser) --

  const addIsland = useCallback(async () => {
    const transform = panZoom.current!.getTransform();
    const viewport = viewportRef.current?.getBoundingClientRect();
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
      next.set(manifest.id, { manifest, etag, dirty: false, idPath: [manifest.id] });
      return next;
    });
  }, []);

  // -- Striche/Text entgegennehmen + debounced speichern -------------------

  // "Zuletzt beruehrt liegt oben" (siehe ownership.ts): bei jedem pointerdown
  // auf einer Insel deren z ueber das aller GESCHWISTER (gleicher
  // Eltern-Pfad, nicht global) heben.
  const bumpIslandZ = useCallback((islandId: string) => {
    setIslands((current) => {
      const entry = current.get(islandId);
      if (!entry) return current;

      const siblings = directChildrenOf(current, entry.idPath.slice(0, -1));
      const othersMaxZ = Math.max(-Infinity, ...siblings.filter((e) => e.manifest.id !== islandId).map((e) => e.manifest.z));
      if (entry.manifest.z > othersMaxZ) return current; // bereits eindeutig oben, nichts zu tun

      const next = new Map(current);
      next.set(islandId, { ...entry, manifest: { ...entry.manifest, z: othersMaxZ + 1 }, dirty: true });
      return next;
    });
    scheduleSave(islandId);
  }, [scheduleSave]);

  const handleStrokeCommitted = useCallback(
    (islandId: string, layerId: string, stroke: Stroke) => {
      setIslands((current) => {
        const entry = current.get(islandId);
        if (!entry) return current;

        const layers = entry.manifest.layers.map((layer) =>
          layer.id === layerId ? { ...layer, strokes: [...layer.strokes, stroke] } : layer,
        );

        let next = new Map(current);
        next.set(islandId, {
          ...entry,
          manifest: { ...entry.manifest, layers, coastlineDirty: true, thumbnailStale: true },
          dirty: true,
        });
        next = propagateThumbnailStale(next, entry.idPath, scheduleSave);
        return next;
      });
      scheduleSave(islandId);
    },
    [scheduleSave],
  );

  /** Neue Textbox durch Klick in offenes Wasser INNERHALB einer bestehenden Insel (siehe IslandView). */
  const handleCreateTextBox = useCallback(
    (islandId: string, textBox: TextBox) => {
      setIslands((current) => {
        const entry = current.get(islandId);
        if (!entry) return current;

        let next = new Map(current);
        next.set(islandId, {
          ...entry,
          manifest: {
            ...entry.manifest,
            textBoxes: [...entry.manifest.textBoxes, textBox],
            coastlineDirty: true,
            thumbnailStale: true,
          },
          dirty: true,
        });
        next = propagateThumbnailStale(next, entry.idPath, scheduleSave);
        return next;
      });
      scheduleSave(islandId);
    },
    [scheduleSave],
  );

  const handleTextBoxChanged = useCallback(
    (islandId: string, textBoxId: string, content: TextDoc) => {
      setIslands((current) => {
        const entry = current.get(islandId);
        if (!entry) return current;

        const textBoxes = entry.manifest.textBoxes.map((textBox) =>
          textBox.id === textBoxId ? { ...textBox, content } : textBox,
        );

        let next = new Map(current);
        next.set(islandId, {
          ...entry,
          manifest: { ...entry.manifest, textBoxes, coastlineDirty: true, thumbnailStale: true },
          dirty: true,
        });
        next = propagateThumbnailStale(next, entry.idPath, scheduleSave);
        return next;
      });
      scheduleSave(islandId);
    },
    [scheduleSave],
  );

  const handleThumbnailRendered = useCallback((islandId: string) => {
    setIslands((current) => {
      const entry = current.get(islandId);
      if (!entry || !entry.manifest.thumbnailStale) return current;
      const next = new Map(current);
      next.set(islandId, { ...entry, manifest: { ...entry.manifest, thumbnailStale: false }, dirty: true });
      return next;
    });
    scheduleSave(islandId);
  }, [scheduleSave]);

  // -- Verschachtelung: Kind-Lookup fuer IslandView.getChildren -------------

  const childrenByParent = useMemo(() => {
    const map = new Map<string, IslandManifest[]>();
    for (const entry of islands.values()) {
      const parentId = entry.idPath.length >= 2 ? entry.idPath[entry.idPath.length - 2] : '';
      const list = map.get(parentId) ?? [];
      list.push(entry.manifest);
      map.set(parentId, list);
    }
    return map;
  }, [islands]);

  const getChildren = useCallback((islandId: string) => childrenByParent.get(islandId) ?? [], [childrenByParent]);
  const topLevelIslands = childrenByParent.get('') ?? [];

  // -- Undo (Stage E: Layout/Merge, siehe Typ-Definitionen oben) -----------

  const undoStackRef = useRef<UndoEntry[]>([]);
  const pushUndo = useCallback((entry: UndoEntry) => {
    undoStackRef.current.push(entry);
  }, []);

  const undo = useCallback(async () => {
    const entry = undoStackRef.current.pop();
    if (!entry) return;

    if (entry.type === 'layout') {
      await flushSave(entry.islandId); // siehe flushSave-Doku
      const current = islandsRef.current.get(entry.islandId);
      if (!current) return;
      const newEtag = await moveIsland(current.idPath, entry.fromParentIdPath, entry.fromX, entry.fromY);
      setIslands((cur) => reparentSubtree(cur, entry.islandId, entry.fromParentIdPath, entry.fromX, entry.fromY, newEtag));
      return;
    }

    // Merge zuruecknehmen: Kind-Inseln zurueck zu source, Ziel-Manifest auf
    // den Vor-Merge-Stand zuruecksetzen, Quelle entflaggen.
    const childEtags = new Map<string, string>();
    for (const child of entry.childMoves) {
      await flushSave(child.id);
      const childEntry = islandsRef.current.get(child.id);
      if (childEntry) {
        const newEtag = await moveIsland(childEntry.idPath, child.fromParentIdPath, child.fromX, child.fromY);
        childEtags.set(child.id, newEtag);
      }
    }

    const targetEntry = islandsRef.current.get(entry.targetId);
    let restoredTargetEtag = targetEntry?.etag ?? '';
    if (targetEntry) {
      restoredTargetEtag = await putIsland(targetEntry.idPath, entry.targetManifestBefore, targetEntry.etag);
    }

    await unflagIslandForDeletion(entry.sourceIdPath);
    const { manifest: restoredSourceManifest, etag: restoredSourceEtag } = await fetchIsland(entry.sourceIdPath);

    setIslands((cur) => {
      let next = new Map(cur);
      next.set(entry.targetId, {
        manifest: entry.targetManifestBefore,
        etag: restoredTargetEtag,
        dirty: false,
        idPath: entry.targetIdPath,
      });
      next.set(entry.sourceId, {
        manifest: restoredSourceManifest,
        etag: restoredSourceEtag,
        dirty: false,
        idPath: entry.sourceIdPath,
      });
      for (const child of entry.childMoves) {
        next = reparentSubtree(next, child.id, child.fromParentIdPath, child.fromX, child.fromY, childEtags.get(child.id));
      }
      return next;
    });
  }, [flushSave]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'z' || event.shiftKey) return;
      // Tiptaps eigenes Undo (StarterKit/History) hat Vorrang, solange eine
      // Textbox den Fokus haelt – unser Stack ist fuer Layout/Merge, nicht
      // fuer Textinhalt.
      const active = document.activeElement as HTMLElement | null;
      if (active?.closest('.textbox-content')) return;
      event.preventDefault();
      void undo();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [undo]);

  // -- Drag & Drop (Stage E: Rand-Merge vs. Mitte-Kind) ---------------------
  //
  // Ausgeloest durch einen Maus-Pointerdown auf ".island-label" (siehe
  // handleSceneDown unten) – waehrend des Ziehens wird NUR das DOM direkt
  // bewegt (dieselbe Hochfrequenz-ausserhalb-von-React-Philosophie wie
  // PanZoomController), React-State erst beim Loslassen aktualisiert.

  interface DragState {
    islandId: string;
    pointerId: number;
    element: HTMLElement;
    startClientX: number;
    startClientY: number;
    startLocalX: number;
    startLocalY: number;
  }
  const dragRef = useRef<DragState | null>(null);

  const finishIslandDrag = useCallback(
    async (drag: DragState, clientX: number, clientY: number) => {
      // ERST flushen, DANN lesen: store.move()/eine Merge-PUT duerfen nicht
      // mit einem veralteten ETag auf eine Insel treffen, die noch einen
      // offenen Debounce-Save hat (siehe flushSave-Doku).
      await flushSave(drag.islandId);
      const sourceEntry = islandsRef.current.get(drag.islandId);
      if (!sourceEntry) return;

      const transform = panZoom.current!.getTransform();
      const deltaX = (clientX - drag.startClientX) / transform.zoom;
      const deltaY = (clientY - drag.startClientY) / transform.zoom;
      const currentLocalX = drag.startLocalX + deltaX;
      const currentLocalY = drag.startLocalY + deltaY;

      const target = resolveOwnerExcluding([...hitNodes.current.values()], clientX, clientY, drag.islandId);

      const oldParentIdPath = sourceEntry.idPath.slice(0, -1);
      const oldParentGlobal = globalPositionOf(oldParentIdPath, islandsRef.current);
      const globalX = oldParentGlobal.x + currentLocalX;
      const globalY = oldParentGlobal.y + currentLocalY;

      const targetEntry = target ? islandsRef.current.get(target.id) ?? null : null;
      const newParentIdPath: IdPath = targetEntry ? targetEntry.idPath : [];
      const newParentGlobal = targetEntry ? globalPositionOf(newParentIdPath, islandsRef.current) : { x: 0, y: 0 };
      const newLocalX = Math.round(globalX - newParentGlobal.x);
      const newLocalY = Math.round(globalY - newParentGlobal.y);

      // Im "tiefen Innenbereich" des Ziels getroffen (Mitte-Drop) -> die
      // Insel wird/bleibt ein reiner Positions-/Eltern-Wechsel, kein Merge.
      const isCenterDrop = !!targetEntry && target!.containsScreenPointInterior(clientX, clientY);

      if (!targetEntry || isCenterDrop) {
        pushUndo({
          type: 'layout',
          islandId: drag.islandId,
          fromParentIdPath: oldParentIdPath,
          fromX: drag.startLocalX,
          fromY: drag.startLocalY,
        });
        const newEtag = await moveIsland(sourceEntry.idPath, newParentIdPath, newLocalX, newLocalY);
        setIslands((cur) => reparentSubtree(cur, drag.islandId, newParentIdPath, newLocalX, newLocalY, newEtag));
        return;
      }

      // Rand-Drop (Merge): Inhalt von source (um den Drop-Offset verschoben)
      // in target uebernehmen, source nur FLAGGEN (nicht loeschen) – per
      // Strg+Z umkehrbar, bis zum naechsten Serverstart (siehe store.ts).
      const offsetX = newLocalX;
      const offsetY = newLocalY;

      const sourceChildren = directChildrenOf(islandsRef.current, sourceEntry.idPath);
      const childMoves: MergeUndoEntry['childMoves'] = [];
      const childEtags = new Map<string, string>();
      for (const child of sourceChildren) {
        await flushSave(child.manifest.id); // siehe flushSave-Doku, gleiches Risiko wie beim Hauptzug.
        const childNewX = child.manifest.x + offsetX;
        const childNewY = child.manifest.y + offsetY;
        childMoves.push({ id: child.manifest.id, fromParentIdPath: sourceEntry.idPath, fromX: child.manifest.x, fromY: child.manifest.y });
        const childNewEtag = await moveIsland(child.idPath, targetEntry.idPath, childNewX, childNewY);
        childEtags.set(child.manifest.id, childNewEtag);
      }

      const maxTargetOrder = targetEntry.manifest.layers.reduce((max, l) => Math.max(max, l.order), -1);
      const shiftedLayers = sourceEntry.manifest.layers.map((layer, i) => ({
        ...layer,
        id: crypto.randomUUID(),
        order: maxTargetOrder + 1 + i,
        strokes: layer.strokes.map((stroke) => ({
          ...stroke,
          points: stroke.points.map((p) => ({ ...p, x: p.x + offsetX, y: p.y + offsetY })),
        })),
      }));
      const shiftedTextBoxes = sourceEntry.manifest.textBoxes.map((tb) => ({
        ...tb,
        id: crypto.randomUUID(),
        x: tb.x + offsetX,
        y: tb.y + offsetY,
      }));

      const mergedTargetManifest: IslandManifest = {
        ...targetEntry.manifest,
        layers: [...targetEntry.manifest.layers, ...shiftedLayers],
        textBoxes: [...targetEntry.manifest.textBoxes, ...shiftedTextBoxes],
        coastlineDirty: true,
        thumbnailStale: true,
      };

      const targetManifestBefore = targetEntry.manifest;
      const newTargetEtag = await putIsland(targetEntry.idPath, mergedTargetManifest, targetEntry.etag);
      await flagIslandForDeletion(sourceEntry.idPath);

      pushUndo({
        type: 'merge',
        sourceId: drag.islandId,
        sourceIdPath: sourceEntry.idPath,
        sourceManifestBefore: sourceEntry.manifest,
        targetId: targetEntry.manifest.id,
        targetIdPath: targetEntry.idPath,
        targetManifestBefore,
        childMoves,
      });

      setIslands((cur) => {
        let next = new Map(cur);
        next.set(targetEntry.manifest.id, {
          manifest: mergedTargetManifest,
          etag: newTargetEtag,
          dirty: false,
          idPath: targetEntry.idPath,
        });
        next.delete(drag.islandId);
        for (const child of childMoves) {
          // child.fromX/fromY sind die ORIGINALEN (Vor-Merge) Koordinaten –
          // next.get(child.id) waere an dieser Stelle noch nicht auf die neue
          // Position aktualisiert (das passiert erst durch reparentSubtree
          // selbst), ein Re-Read daraus wuerde also denselben alten Wert
          // liefern und faelschlich +offset ein zweites Mal draufrechnen.
          next = reparentSubtree(next, child.id, targetEntry.idPath, child.fromX + offsetX, child.fromY + offsetY, childEtags.get(child.id));
        }
        next = propagateThumbnailStale(next, targetEntry.idPath, scheduleSave);
        return next;
      });
    },
    [pushUndo, scheduleSave, flushSave],
  );

  useEffect(() => {
    const handleMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      const transform = panZoom.current!.getTransform();
      const deltaX = (event.clientX - drag.startClientX) / transform.zoom;
      const deltaY = (event.clientY - drag.startClientY) / transform.zoom;
      drag.element.style.left = `${drag.startLocalX + deltaX}px`;
      drag.element.style.top = `${drag.startLocalY + deltaY}px`;
    };
    const handleUp = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      dragRef.current = null;
      void finishIslandDrag(drag, event.clientX, event.clientY);
    };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('pointercancel', handleUp);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('pointercancel', handleUp);
    };
  }, [finishIslandDrag]);

  // Zentrale Ownership-Aufloesung: native Capture-Phase-Listener auf dem
  // Viewport (Ancestor aller Inseln), damit er VOR jedem Insel-eigenen
  // Capture-Listener (move/up/cancel, siehe IslandView) feuert.
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const handleSceneDown = (event: PointerEvent) => {
      // Insel-Verschieben per Drag-Griff – hat Vorrang vor Zeichnen/Textbox-
      // Erzeugung, unabhaengig vom gewaehlten Werkzeug.
      if (event.pointerType === 'mouse') {
        const labelEl = (event.target as HTMLElement).closest?.('.island-label') as HTMLElement | null;
        if (labelEl) {
          const islandEl = labelEl.closest('.island') as HTMLElement | null;
          const islandId = islandEl?.getAttribute('data-island-id') ?? undefined;
          const entry = islandId ? islandsRef.current.get(islandId) : undefined;
          if (islandEl && islandId && entry) {
            event.preventDefault();
            event.stopPropagation();
            dragRef.current = {
              islandId,
              pointerId: event.pointerId,
              element: islandEl,
              startClientX: event.clientX,
              startClientY: event.clientY,
              startLocalX: entry.manifest.x,
              startLocalY: entry.manifest.y,
            };
            try {
              islandEl.setPointerCapture(event.pointerId);
            } catch {
              // Siehe IslandInkController: manche Browser werfen hier, wenn der Pointer schon weg ist.
            }
          }
          return;
        }
      }

      const winner = resolveOwner([...hitNodes.current.values()], event.clientX, event.clientY);
      if (winner) {
        winner.handlePointerDown(event);
        return;
      }

      // Keine Insel getroffen: ein Maus-Klick in "auto"-Modus auf offenem
      // Meer legt eine neue Insel an (siehe createIslandWithTextBox).
      // stopPropagation(), damit der Bubble-Phase-Pan-Handler (siehe
      // onViewportPointerDown) aus demselben Klick keine Drag-Geste startet.
      if (event.pointerType === 'mouse' && toolRef.current.mode === 'auto') {
        const rect = viewportRef.current?.getBoundingClientRect();
        if (!rect) return;
        const transform = panZoom.current!.getTransform();
        const worldX = (event.clientX - rect.left - transform.x) / transform.zoom;
        const worldY = (event.clientY - rect.top - transform.y) / transform.zoom;
        event.stopPropagation();
        void createIslandWithTextBox(worldX, worldY);
      }
    };

    viewport.addEventListener('pointerdown', handleSceneDown, { capture: true });
    return () => viewport.removeEventListener('pointerdown', handleSceneDown, { capture: true });
  }, [createIslandWithTextBox]);

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

  // -- Laden (rekursiv – siehe LoadedIsland.idPath) ------------------------

  useEffect(() => {
    let cancelled = false;

    async function walk(node: TreeNode, idPath: IdPath, loaded: Map<string, LoadedIsland>): Promise<void> {
      if (idPath.length > 0) {
        const { manifest, etag } = await fetchIsland(idPath);
        if (cancelled) return;
        loaded.set(manifest.id, { manifest, etag, dirty: false, idPath });
      }
      for (const child of node.children) {
        if (cancelled) return;
        await walk(child, [...idPath, child.id], loaded);
      }
    }

    async function load() {
      try {
        const tree = await fetchTree();
        if (cancelled) return;
        const loaded = new Map<string, LoadedIsland>();
        await walk(tree, [], loaded);
        if (!cancelled) setIslands(loaded);
      } catch (error) {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : String(error));
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const sceneValue = useMemo<SceneContextValue>(
    () => ({
      getTransform: () => panZoom.current!.getTransform(),
      getViewportElement: () => viewportRef.current,
      registerResync: (id, fn) => resyncCallbacks.current.set(id, fn),
      unregisterResync: (id) => resyncCallbacks.current.delete(id),
      registerIslandHitNode: (node) => {
        // parentId aus der zentral gefuehrten idPath ableiten, statt dass
        // jede Insel ihre eigene Verschachtelungstiefe selbst kennen muesste
        // (siehe ownership.ts: resolveOwner baut die Baum-Ebenen daraus).
        const entry = islandsRef.current.get(node.id);
        const idPath = entry?.idPath ?? [node.id];
        const parentId = idPath.length >= 2 ? idPath[idPath.length - 2] : null;
        hitNodes.current.set(node.id, { ...node, parentId });
      },
      unregisterIslandHitNode: (id) => hitNodes.current.delete(id),
      toolRef,
      router,
      getChildren,
      onStrokeCommitted: handleStrokeCommitted,
      onTouched: bumpIslandZ,
      onCreateTextBox: handleCreateTextBox,
      onTextBoxChange: handleTextBoxChanged,
      onThumbnailRendered: handleThumbnailRendered,
    }),
    [toolRef, router, getChildren, handleStrokeCommitted, bumpIslandZ, handleCreateTextBox, handleTextBoxChanged, handleThumbnailRendered],
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
            {topLevelIslands.map((manifest) => (
              <IslandView
                key={manifest.id}
                island={manifest}
                initialAutofocusTextBoxId={pendingIslandFocusRef.current.get(manifest.id)}
              />
            ))}
          </div>
        </div>
      </div>
    </SceneProvider>
  );
}
