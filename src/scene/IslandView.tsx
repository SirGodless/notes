import { memo, useEffect, useRef, useState } from 'react';

import { PAGE_HEIGHT, PAGE_WIDTH } from '../config';
import { useNearViewport } from '../hooks/useNearViewport';
import type { Bounds } from '../ink/geometry';
import { prepareCanvas } from '../ink/renderer';
import { createTextBox, type IslandManifest } from '../model/island';
import type { InkLayer } from '../model/types';
import { loopsToSvgPath } from './coastline';
import { IslandInkController, type IslandInkHost } from './IslandInkController';
import type { IslandHitNode } from './ownership';
import { useScene } from './SceneContext';
import { TextBoxView } from './TextBoxView';
import { renderThumbnail } from './thumbnailCache';
import { TileGrid } from './TileGrid';
import { useCoastline } from './useCoastline';

/** Rand um den Viewport, in dem Inseln schon Kacheln bekommen, bevor sie ganz sichtbar sind. */
const MOUNT_MARGIN_PX = 600;
/** Unterschreitet eine Insel auf dem Bildschirm diese Kantenlaenge, wird aus der Miniatur geblittet (siehe Plan). */
const THUMBNAIL_THRESHOLD_PX = 300;
/** Debounce fuer die Miniatur-Neuberechnung, analog useCoastline. */
const THUMBNAIL_RECOMPUTE_DEBOUNCE_MS = 400;

interface IslandViewProps {
  /**
   * Das VOLLE Manifest, nicht nur ein Teilausschnitt – damit ein spaeteres
   * Speichern (siehe SeaView.scheduleSave) nichts rekonstruieren muss und
   * Felder wie z/coastlineDirty/thumbnailStale nicht verloren gehen.
   */
  island: IslandManifest;
  /**
   * Nur fuer eine Insel, die GERADE JETZT durch einen Klick in offenes Meer
   * entstanden ist (siehe SeaView.createIslandWithTextBox) – ihre einzige
   * Textbox soll sofort den Cursor bekommen, ohne zweiten Klick.
   */
  initialAutofocusTextBoxId?: string;
}

/**
 * Eine Insel: Platzhalter-Flaeche mit fester Groesse (PAGE_WIDTH x
 * PAGE_HEIGHT – siehe Kommentar unten zur "unendliches Dokument"-
 * Einschraenkung), darauf aufgezeichnet die inhaltsgetriebene Kuestenlinie
 * (Stage C), mit einem TileGrid pro Ink-Ebene und einem ungekachelten
 * Wet-Canvas fuer den gerade laufenden Stift-Strich.
 *
 * WICHTIG (Stage-C-Einschraenkung, bewusst nicht geloest): der Plan
 * beschreibt eine Insel als "unendliches Dokument" ohne harte Grenze. Die
 * Pointer-Koordinatenumrechnung (siehe IslandInkController.appendPoint)
 * braucht aber eine FESTE, bekannte Insel-lokale Breite/Hoehe fuer den
 * Verhaeltnis-Trick ueber getBoundingClientRect(). Deshalb bleibt die
 * interaktive Flaeche einer Insel vorerst bei PAGE_WIDTH x PAGE_HEIGHT
 * (wie v1s Seite), WAEHREND die sichtbare Kuestenlinie bereits organisch
 * aus dem Inhalt waechst.
 *
 * Seit Stage E (Verschachtelung): rendert rekursiv ihre eigenen Kind-Inseln
 * (scene.getChildren(island.id)) als direkte DOM-Kinder – weil dieser Div
 * selbst `position: absolute` ist, wird er automatisch zum Containing Block
 * fuer die absolut positionierten Kind-Insel-Divs, ganz ohne zusaetzlichen
 * Transform-Code pro Verschachtelungsebene.
 */
export const IslandView = memo(function IslandView({ island, initialAutofocusTextBoxId }: IslandViewProps) {
  const scene = useScene();
  const { toolRef, router } = scene;

  const elementRef = useRef<HTMLDivElement | null>(null);
  const isNear = useNearViewport(elementRef, MOUNT_MARGIN_PX);

  // Siehe initialAutofocusTextBoxId-Doku: einmalig als Startwert gesetzt
  // (neue Insel aus offenem Meer), danach bei jedem Klick in offenes Wasser
  // INNERHALB der Insel neu belegt (siehe Ownership-Registrierung unten) und
  // nach dem Rendern sofort wieder geleert, damit spaetere Re-Renders keine
  // alte Textbox erneut fokussieren.
  const pendingFocusIdRef = useRef<string | null>(initialAutofocusTextBoxId ?? null);

  const tileGridsRef = useRef(new Map<string, TileGrid>());
  const layersRef = useRef(island.layers);
  layersRef.current = island.layers;

  const wetCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const wetCtxRef = useRef<CanvasRenderingContext2D | null>(null);

  const coastline = useCoastline(island.id, island.layers, island.textBoxes);
  const coastlineRef = useRef(coastline);
  coastlineRef.current = coastline;

  // WICHTIG: haengt NICHT an `island.layers` direkt. Dessen Array-Referenz
  // aendert sich bei JEDEM Strich (SeaView baut die Ebenen-Liste neu), auch
  // wenn sich die SET von Ebenen-IDs dabei gar nicht aendert. Haette die
  // beiden folgenden Effekte trotzdem an `island.layers` gehaengt, wuerde
  // ihr Cleanup (grid.detach()) nach jedem einzelnen Strich ALLE
  // Kachel-Canvases aus dem DOM entfernen, bis zum naechsten Pan/Zoom-
  // Resync wieder was zu sehen ist – Tinte wuerde kurz nach jedem Strich
  // verschwinden. Deshalb ein auf die ID-Menge reduzierter, stabiler Key.
  const layerIdsKey = island.layers.map((layer) => layer.id).join(',');

  // -- Miniatur statt Kacheln, wenn die Insel auf dem Bildschirm sehr klein ist --
  const [useThumbnail, setUseThumbnail] = useState(false);
  const thumbnailUrlRef = useRef<string>('');
  const [thumbnailVersion, setThumbnailVersion] = useState(0);
  const thumbnailTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Signatur statt Array-Referenz, gleiche Begruendung wie layerIdsKey/useCoastline.
  const contentSignature =
    island.layers.map((l) => `${l.id}:${l.strokes.length}`).join('|') +
    '~' +
    island.textBoxes.map((t) => `${t.id}:${t.x}:${t.y}`).join('|');

  useEffect(() => {
    if (!island.thumbnailStale) return;
    if (thumbnailTimerRef.current) clearTimeout(thumbnailTimerRef.current);
    thumbnailTimerRef.current = setTimeout(() => {
      thumbnailUrlRef.current = renderThumbnail(island);
      setThumbnailVersion((v) => v + 1);
      scene.onThumbnailRendered(island.id, thumbnailUrlRef.current);
    }, THUMBNAIL_RECOMPUTE_DEBOUNCE_MS);
    return () => {
      if (thumbnailTimerRef.current) clearTimeout(thumbnailTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [island.thumbnailStale, contentSignature]);

  // TileGrid pro Ebene anlegen/entfernen – nur wenn sich die ID-MENGE aendert.
  useEffect(() => {
    const grids = tileGridsRef.current;
    const liveIds = new Set(layerIdsKey.split(',').filter(Boolean));

    for (const [layerId, grid] of grids) {
      if (!liveIds.has(layerId)) {
        grid.detach();
        grids.delete(layerId);
      }
    }
    for (const id of liveIds) {
      if (!grids.has(id)) grids.set(id, new TileGrid());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layerIdsKey]);

  // Container-Elemente anhaengen – ebenfalls nur bei echter Strukturaenderung.
  const layerContainerRefs = useRef(new Map<string, HTMLDivElement>());
  useEffect(() => {
    if (!isNear || useThumbnail) return;
    for (const id of layerIdsKey.split(',').filter(Boolean)) {
      const container = layerContainerRefs.current.get(id);
      const grid = tileGridsRef.current.get(id);
      if (container && grid) grid.attach(container);
    }
    return () => {
      for (const grid of tileGridsRef.current.values()) grid.detach();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNear, layerIdsKey, useThumbnail]);

  useEffect(() => {
    const canvas = wetCanvasRef.current;
    if (!isNear || !canvas || useThumbnail) {
      wetCtxRef.current = null;
      return;
    }
    wetCtxRef.current = prepareCanvas(canvas, 2, PAGE_WIDTH, PAGE_HEIGHT);
    return () => {
      wetCtxRef.current = null;
    };
  }, [isNear, useThumbnail]);

  /** Berechnet, welcher insel-lokale Ausschnitt gerade auf dem Bildschirm liegt. */
  const computeVisibleLocalRect = (): Bounds | null => {
    const element = elementRef.current;
    const viewport = scene.getViewportElement();
    if (!element || !viewport) return null;

    const elementRect = element.getBoundingClientRect();
    const viewportRect = viewport.getBoundingClientRect();
    if (elementRect.width === 0 || elementRect.height === 0) return null;

    // Schnittmenge aus Insel-Rect und Viewport-Rect, in Bildschirm-Pixeln.
    const left = Math.max(elementRect.left, viewportRect.left);
    const top = Math.max(elementRect.top, viewportRect.top);
    const right = Math.min(elementRect.right, viewportRect.right);
    const bottom = Math.min(elementRect.bottom, viewportRect.bottom);
    if (right <= left || bottom <= top) return null;

    // Zurueck in Insel-lokale Welteinheiten – derselbe Verhaeltnis-Trick wie
    // beim Umrechnen von Pointer-Events (siehe IslandInkController), nur auf
    // ein Rechteck statt einen Punkt angewendet.
    return {
      minX: ((left - elementRect.left) / elementRect.width) * PAGE_WIDTH,
      minY: ((top - elementRect.top) / elementRect.height) * PAGE_HEIGHT,
      maxX: ((right - elementRect.left) / elementRect.width) * PAGE_WIDTH,
      maxY: ((bottom - elementRect.top) / elementRect.height) * PAGE_HEIGHT,
    };
  };

  /** Bildschirm- -> insel-lokale Koordinaten, fuer den Kuestenlinien-Hit-Test. */
  const screenToLocal = (clientX: number, clientY: number): { x: number; y: number } | null => {
    const element = elementRef.current;
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    return {
      x: ((clientX - rect.left) / rect.width) * PAGE_WIDTH,
      y: ((clientY - rect.top) / rect.height) * PAGE_HEIGHT,
    };
  };

  const resync = (): void => {
    const element = elementRef.current;
    if (element) {
      const rect = element.getBoundingClientRect();
      const tiny = Math.min(rect.width, rect.height) < THUMBNAIL_THRESHOLD_PX;
      setUseThumbnail((current) => (current === tiny ? current : tiny));
    }

    if (!isNear || useThumbnail) return;
    const rect = computeVisibleLocalRect();
    if (!rect) return;
    for (const layer of layersRef.current) {
      tileGridsRef.current.get(layer.id)?.sync(rect, layer.strokes);
    }
  };

  // Bei SceneContext anmelden: wird nach jeder Pan/Zoom-Aenderung gerufen.
  useEffect(() => {
    scene.registerResync(island.id, resync);
    resync();
    return () => scene.unregisterResync(island.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [island.id, isNear, useThumbnail, scene]);

  // Striche neu zuordnen, wenn sich die Ebenen-Daten aendern (z.B. Undo).
  useEffect(() => {
    if (!isNear || useThumbnail) return;
    for (const layer of island.layers) {
      const grid = tileGridsRef.current.get(layer.id);
      const rect = computeVisibleLocalRect();
      if (grid && rect) grid.sync(rect, layer.strokes);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [island.layers, isNear, useThumbnail]);

  // Pointer-Handling: eigener Controller pro Insel, gemeinsamer Router.
  // Der Controller selbst bekommt NUR move/up/cancel als eigenen Listener
  // (siehe unten) – pointerdown kommt ausschliesslich ueber die zentrale
  // Ownership-Aufloesung in SeaView (resolveOwner -> hitNode.handlePointerDown),
  // sonst wuerden bei ueberlappenden Inseln mehrere DOM-Elemente gleichzeitig
  // unabhaengig voneinander "ja, meins" sagen.
  const controllerRef = useRef<IslandInkController | null>(null);
  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;

    const host: IslandInkHost = {
      getIslandElement: () => elementRef.current,
      getWorldSize: () => ({ width: PAGE_WIDTH, height: PAGE_HEIGHT }),
      getWetContext: () => wetCtxRef.current,
      getTileGrid: (layerId) => tileGridsRef.current.get(layerId) ?? null,
      getDrawingState: () => {
        const tool = toolRef.current;
        // Oberste Ebene nach `order`, nicht nach Array-Position – bis zu
        // einer echten Ebenenauswahl zeichnet man immer auf die zuoberst
        // liegende (wie v1s topmostVisibleLayer).
        const activeLayer = layersRef.current.reduce<InkLayer | null>(
          (top, layer) => (!top || layer.order > top.order ? layer : top),
          null,
        );
        return {
          activeLayerId: activeLayer?.id ?? null,
          toolMode: tool.mode,
          color: tool.color,
          penWidth: tool.penWidth,
          eraserWidth: tool.eraserWidth,
        };
      },
      onStrokeCommitted: (layerId, stroke) => {
        scene.onStrokeCommitted(island.id, layerId, stroke);
      },
    };

    const controller = new IslandInkController(host, router);
    controllerRef.current = controller;
    const options = { capture: true, passive: false } as const;

    element.addEventListener('pointermove', controller.handlePointerMove, options);
    element.addEventListener('pointerup', controller.handlePointerUp, options);
    element.addEventListener('pointercancel', controller.handlePointerCancel, options);
    element.addEventListener('lostpointercapture', controller.handlePointerCancel, options);

    return () => {
      element.removeEventListener('pointermove', controller.handlePointerMove, options);
      element.removeEventListener('pointerup', controller.handlePointerUp, options);
      element.removeEventListener('pointercancel', controller.handlePointerCancel, options);
      element.removeEventListener('lostpointercapture', controller.handlePointerCancel, options);
      controller.dispose();
      controllerRef.current = null;
    };
  }, [router, toolRef, scene, island.id]);

  // Bei der Ownership-Registry anmelden (siehe scene/ownership.ts).
  useEffect(() => {
    const node: IslandHitNode = {
      id: island.id,
      parentId: null, // SeaView setzt dies beim Registrieren korrekt (siehe scene.registerIslandHitNode-Wrapper unten).
      z: island.z,
      containsScreenPoint: (clientX, clientY) => {
        const local = screenToLocal(clientX, clientY);
        if (!local) return false;
        // Eine brandneue Insel hat noch keinen Inhalt, also auch noch keine
        // Kuestenlinie (leere Schleifenliste, containsPoint waere ueberall
        // false) – dann wuerde sie NIE ihren ersten Strich bekommen koennen.
        // Deshalb: ohne Inhalt zaehlt die ganze interaktive Flaeche als
        // "innerhalb". Sobald echter Inhalt existiert, uebernimmt die
        // tatsaechliche Kuestenlinie.
        if (coastlineRef.current.loops.length === 0) {
          return local.x >= 0 && local.x <= PAGE_WIDTH && local.y >= 0 && local.y <= PAGE_HEIGHT;
        }
        return coastlineRef.current.containsPoint(local.x, local.y);
      },
      containsScreenPointInterior: (clientX, clientY) => {
        const local = screenToLocal(clientX, clientY);
        if (!local) return false;
        // NICHT coastline.bounds (das ist die Bounding-Box der schon um
        // KUESTENABSTAND aufgeblähten Kontur, also praktisch deckungsgleich
        // mit "ueberhaupt auf der Insel") – contentBounds ist die Bounding-Box
        // des ROHEN Inhalts, siehe useCoastline.ts.
        const bounds = coastlineRef.current.contentBounds;
        if (!bounds) return false;
        return local.x >= bounds.minX && local.x <= bounds.maxX && local.y >= bounds.minY && local.y <= bounds.maxY;
      },
      screenToLocal,
      handlePointerDown: (event) => {
        scene.onTouched(island.id);

        // Maus-Klick in "auto"-Modus, der KEINE vorhandene Textbox trifft:
        // Stift/Radiergummi zeichnen weiter wie gewohnt (ueber den
        // Controller), aber ein Klick ins offene Wasser INNERHALB der Insel
        // erzeugt eine neue Textbox dort – siehe Plan, Abschnitt
        // "Textboxen": "Entstehen, wo man zu tippen beginnt."
        if (event.pointerType === 'mouse' && toolRef.current.mode === 'auto') {
          const targetElement = event.target as HTMLElement | null;
          const onExistingTextBox = targetElement?.closest?.('.textbox');
          if (!onExistingTextBox) {
            const local = screenToLocal(event.clientX, event.clientY);
            if (local) {
              const textBox = createTextBox({ x: Math.round(local.x), y: Math.round(local.y) });
              pendingFocusIdRef.current = textBox.id;
              scene.onCreateTextBox(island.id, textBox);
              return;
            }
          }
        }

        controllerRef.current?.handlePointerDown(event);
      },
    };
    scene.registerIslandHitNode(node);
    return () => scene.unregisterIslandHitNode(island.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [island.id, island.z, scene, toolRef]);

  const sortedLayers = [...island.layers].sort((a, b) => a.order - b.order);

  // Siehe pendingFocusIdRef-Doku oben: wird waehrend dieses Renders gelesen
  // (fuer hoechstens EINE Textbox pro Insel "wahr"), NICHT aber direkt hier
  // im Render-Koerper geleert (siehe Effekt weiter unten) – React (Dev-
  // StrictMode) ruft Render-Funktionen zur Reinheits-Pruefung manchmal
  // zweimal auf; eine Ref-MUTATION waehrend des Renders wuerde dann beim
  // zweiten Aufruf den bereits geleerten Wert sehen, wodurch der Fokus-Flag
  // nichtdeterministisch verloren gehen koennte. Nur LESEN ist dagegen rein
  // und liefert bei jedem der beiden Aufrufe denselben Wert.
  const textBoxElements = island.textBoxes.map((textBox) => (
    <TextBoxView
      key={textBox.id}
      textBox={textBox}
      autofocus={isNear && pendingFocusIdRef.current === textBox.id}
      onChange={(content) => scene.onTextBoxChange(island.id, textBox.id, content)}
      onFocus={() => scene.onTouched(island.id)}
    />
  ));

  // Leeren NACH dem Commit (siehe Begruendung oben), nur wenn isNear – vor
  // dem ersten echten Mount (isNear noch false) soll der Flag ueberleben.
  useEffect(() => {
    if (isNear) pendingFocusIdRef.current = null;
  });

  const svgPath = loopsToSvgPath(coastline.loops);
  const svgBounds = coastline.bounds ?? { minX: 0, minY: 0, maxX: PAGE_WIDTH, maxY: PAGE_HEIGHT };
  // Etwas Rand um die berechneten Bounds, damit die Glaettungs-/Stoerungs-
  // Ueberschwinger der Kontur (siehe coastline.ts) nicht am SVG-Rand
  // abgeschnitten werden.
  const svgMargin = 12;

  const children = scene.getChildren(island.id);

  return (
    <div
      ref={elementRef}
      className="island"
      data-island-id={island.id}
      style={{
        position: 'absolute',
        left: island.x,
        top: island.y,
        width: PAGE_WIDTH,
        height: PAGE_HEIGHT,
        touchAction: 'none',
      }}
    >
      {svgPath && (
        <svg
          className="island-coastline"
          style={{
            position: 'absolute',
            // Das SVG selbst muss an die Bounds-Position gerueckt werden –
            // der viewBox-Ursprung allein verschiebt nur den INHALT
            // innerhalb des SVG, nicht das SVG-Element auf der Seite.
            left: svgBounds.minX - svgMargin,
            top: svgBounds.minY - svgMargin,
            overflow: 'visible',
            pointerEvents: 'none',
          }}
          width={svgBounds.maxX - svgBounds.minX + svgMargin * 2}
          height={svgBounds.maxY - svgBounds.minY + svgMargin * 2}
          viewBox={`${svgBounds.minX - svgMargin} ${svgBounds.minY - svgMargin} ${svgBounds.maxX - svgBounds.minX + svgMargin * 2} ${svgBounds.maxY - svgBounds.minY + svgMargin * 2}`}
        >
          <path d={svgPath} className="island-coastline-path" />
        </svg>
      )}

      {/* Drag-Griff – siehe SeaView.handleSceneDown fuer die Erkennung von Klicks hierauf. */}
      <div className="island-label">{island.name}</div>

      {useThumbnail ? (
        thumbnailUrlRef.current && (
          <img
            key={thumbnailVersion}
            src={thumbnailUrlRef.current}
            className="island-thumbnail"
            alt=""
            style={{ position: 'absolute', inset: 0, width: PAGE_WIDTH, height: PAGE_HEIGHT, zIndex: 5, pointerEvents: 'none' }}
          />
        )
      ) : (
        <>
          {isNear &&
            sortedLayers.map((layer) => (
              <div
                key={layer.id}
                className="island-layer-tiles"
                ref={(el) => {
                  if (el) layerContainerRefs.current.set(layer.id, el);
                  else layerContainerRefs.current.delete(layer.id);
                }}
                style={{ position: 'absolute', inset: 0, zIndex: 10 + layer.order }}
              />
            ))}

          {isNear && (
            <canvas
              ref={wetCanvasRef}
              className="island-wet-layer"
              style={{ position: 'absolute', inset: 0, width: PAGE_WIDTH, height: PAGE_HEIGHT, zIndex: 900, pointerEvents: 'none' }}
            />
          )}

          {isNear && textBoxElements}
        </>
      )}

      {children.map((child) => (
        <IslandView key={child.id} island={child} />
      ))}
    </div>
  );
});
