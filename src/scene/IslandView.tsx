import { memo, useEffect, useRef } from 'react';

import { PAGE_HEIGHT, PAGE_WIDTH } from '../config';
import { useNearViewport } from '../hooks/useNearViewport';
import type { Bounds } from '../ink/geometry';
import type { PointerRouter } from '../ink/pointerRouter';
import { prepareCanvas } from '../ink/renderer';
import type { IslandManifest } from '../model/island';
import type { InkLayer, Stroke } from '../model/types';
import { IslandInkController, type IslandInkHost } from './IslandInkController';
import { useScene } from './SceneContext';
import type { SceneToolState } from './sceneToolState';
import { TileGrid } from './TileGrid';

/** Rand um den Viewport, in dem Inseln schon Kacheln bekommen, bevor sie ganz sichtbar sind. */
const MOUNT_MARGIN_PX = 600;

interface IslandViewProps {
  /**
   * Das VOLLE Manifest, nicht nur ein Teilausschnitt – damit ein spaeteres
   * Speichern (siehe SeaView.scheduleSave) nichts rekonstruieren muss und
   * Felder wie z/coastlineDirty/thumbnailStale nicht verloren gehen.
   */
  island: IslandManifest;
  toolRef: React.RefObject<SceneToolState>;
  router: PointerRouter;
  onStrokeCommitted: (layerId: string, stroke: Stroke) => void;
}

/**
 * Eine Insel: fest positioniert (Stage B: feste A4-Groesse als Platzhalter-
 * Rechteck – Stage C ersetzt das durch eine inhaltsgetriebene Kuestenlinie),
 * mit einem TileGrid pro Ink-Ebene und einem ungekachelten Wet-Canvas fuer
 * den gerade laufenden Stift-Strich.
 *
 * Reihenfolge der Ebenen im DOM entspricht `layers[].order` (niedrig =
 * weiter unten), wie in v1.
 */
export const IslandView = memo(function IslandView({
  island,
  toolRef,
  router,
  onStrokeCommitted,
}: IslandViewProps) {
  const elementRef = useRef<HTMLDivElement | null>(null);
  const isNear = useNearViewport(elementRef, MOUNT_MARGIN_PX);

  const tileGridsRef = useRef(new Map<string, TileGrid>());
  const layersRef = useRef(island.layers);
  layersRef.current = island.layers;

  const wetCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const wetCtxRef = useRef<CanvasRenderingContext2D | null>(null);

  const scene = useScene();

  // WICHTIG: haengt NICHT an `island.layers` direkt. Dessen Array-Referenz
  // aendert sich bei JEDEM Strich (SeaView baut die Ebenen-Liste neu), auch
  // wenn sich die SET von Ebenen-IDs dabei gar nicht aendert. Haette die
  // beiden folgenden Effekte trotzdem an `island.layers` gehaengt, wuerde
  // ihr Cleanup (grid.detach()) nach jedem einzelnen Strich ALLE
  // Kachel-Canvases aus dem DOM entfernen, bis zum naechsten Pan/Zoom-
  // Resync wieder was zu sehen ist – Tinte wuerde kurz nach jedem Strich
  // verschwinden. Deshalb ein auf die ID-Menge reduzierter, stabiler Key.
  const layerIdsKey = island.layers.map((layer) => layer.id).join(',');

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
    if (!isNear) return;
    for (const id of layerIdsKey.split(',').filter(Boolean)) {
      const container = layerContainerRefs.current.get(id);
      const grid = tileGridsRef.current.get(id);
      if (container && grid) grid.attach(container);
    }
    return () => {
      for (const grid of tileGridsRef.current.values()) grid.detach();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNear, layerIdsKey]);

  useEffect(() => {
    const canvas = wetCanvasRef.current;
    if (!isNear || !canvas) {
      wetCtxRef.current = null;
      return;
    }
    wetCtxRef.current = prepareCanvas(canvas, 2, PAGE_WIDTH, PAGE_HEIGHT);
    return () => {
      wetCtxRef.current = null;
    };
  }, [isNear]);

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

  const resync = (): void => {
    if (!isNear) return;
    const rect = computeVisibleLocalRect();
    if (!rect) return;
    for (const layer of layersRef.current) {
      tileGridsRef.current.get(layer.id)?.sync(rect, layer.strokes);
    }
  };

  // Bei SceneContext anmelden: wird nach jeder Pan/Zoom-Aenderung gerufen.
  useEffect(() => {
    scene.registerResync(island.id, resync);
    if (isNear) resync();
    return () => scene.unregisterResync(island.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [island.id, isNear, scene]);

  // Striche neu zuordnen, wenn sich die Ebenen-Daten aendern (z.B. Undo).
  useEffect(() => {
    if (!isNear) return;
    for (const layer of island.layers) {
      const grid = tileGridsRef.current.get(layer.id);
      const rect = computeVisibleLocalRect();
      if (grid && rect) grid.sync(rect, layer.strokes);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [island.layers, isNear]);

  // Pointer-Handling: eigener Controller pro Insel, gemeinsamer Router.
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
        // Oberste Ebene nach `order`, nicht nach Array-Position – Stage D/E
        // bringt eine echte Ebenenauswahl, bis dahin zeichnet man immer auf
        // die zuoberst liegende (wie v1s topmostVisibleLayer).
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
        const grid = tileGridsRef.current.get(layerId);
        // Fuer Stift bereits in TileGrid.commitStroke geschehen (siehe
        // IslandInkController); fuer den Radiergummi muss hier NICHTS
        // zusaetzlich passieren – deren Kacheln sind durch den Live-Pfad
        // schon aktuell. Der Bounds-Cache-Eintrag entsteht bei Bedarf lazy.
        void grid;
        onStrokeCommitted(layerId, stroke);
      },
    };

    const controller = new IslandInkController(host, router);
    const options = { capture: true, passive: false } as const;

    element.addEventListener('pointerdown', controller.handlePointerDown, options);
    element.addEventListener('pointermove', controller.handlePointerMove, options);
    element.addEventListener('pointerup', controller.handlePointerUp, options);
    element.addEventListener('pointercancel', controller.handlePointerCancel, options);
    element.addEventListener('lostpointercapture', controller.handlePointerCancel, options);

    return () => {
      element.removeEventListener('pointerdown', controller.handlePointerDown, options);
      element.removeEventListener('pointermove', controller.handlePointerMove, options);
      element.removeEventListener('pointerup', controller.handlePointerUp, options);
      element.removeEventListener('pointercancel', controller.handlePointerCancel, options);
      element.removeEventListener('lostpointercapture', controller.handlePointerCancel, options);
      controller.dispose();
    };
  }, [router, toolRef, onStrokeCommitted]);

  const sortedLayers = [...island.layers].sort((a, b) => a.order - b.order);

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
      <div className="island-label">{island.name}</div>

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
    </div>
  );
});
