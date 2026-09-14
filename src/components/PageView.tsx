import { memo, useCallback, useEffect, useMemo, useRef } from 'react';
import type { Editor } from '@tiptap/react';

import { PAGE_HEIGHT, PAGE_MOUNT_MARGIN_PX, PAGE_WIDTH } from '../config';
import { InkEngine, type InkHost } from '../ink/InkEngine';
import { LayerSurface, WetSurface } from '../ink/LayerSurface';
import type { PointerRouter } from '../ink/pointerRouter';
import type { Page, Stroke, TextDoc } from '../model/types';
import type { ToolState } from '../state/toolState';
import { useNearViewport } from '../hooks/useNearViewport';
import { InkLayerCanvas } from './InkLayerCanvas';
import { TextLayer } from './TextLayer';

interface PageViewProps {
  page: Page;
  pageNumber: number;
  totalPages: number;
  zoom: number;
  penActive: boolean;
  router: PointerRouter;
  toolRef: React.RefObject<ToolState>;
  activeLayerId: string | null;
  isFocused: boolean;
  onFocus: () => void;
  onStrokeCommitted: (layerId: string, stroke: Stroke) => void;
  onTextChange: (text: TextDoc) => void;
  onEditorReady: (editor: Editor | null) => void;
}

/**
 * Eine DIN-A4-Seite: Text unten, Ink-Ebenen darueber, ganz oben das
 * Zwischen-Canvas fuer den laufenden Strich.
 *
 * Hier wird auch die Pointer-Logik verdrahtet. Die Listener haengen als native
 * Listener in der Capture-Phase am Seitencontainer – dadurch kommen sie vor
 * dem contenteditable des Text-Layers dran und koennen Stift-Eingaben
 * abfangen, bevor der Browser daraus eine Cursor-Positionierung macht.
 */
export const PageView = memo(function PageView({
  page,
  pageNumber,
  totalPages,
  zoom,
  penActive,
  router,
  toolRef,
  activeLayerId,
  isFocused,
  onFocus,
  onStrokeCommitted,
  onTextChange,
  onEditorReady,
}: PageViewProps) {
  const pageRef = useRef<HTMLDivElement | null>(null);
  const surfaces = useRef(new Map<string, LayerSurface>()).current;
  const wetSurface = useRef(new WetSurface()).current;
  const wetCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // Werte, die die Engine aus Event-Handlern liest. Als Ref, damit ein
  // Ebenenwechsel die Engine nicht neu aufbauen muss.
  const activeLayerRef = useRef(activeLayerId);
  const commitRef = useRef(onStrokeCommitted);
  activeLayerRef.current = activeLayerId;
  commitRef.current = onStrokeCommitted;

  const isNear = useNearViewport(pageRef, PAGE_MOUNT_MARGIN_PX, pageNumber <= 2);

  const getSurface = useCallback(
    (layerId: string): LayerSurface => {
      let surface = surfaces.get(layerId);
      if (!surface) {
        surface = new LayerSurface();
        surfaces.set(layerId, surface);
      }
      return surface;
    },
    [surfaces],
  );

  // Surfaces geloeschter Ebenen wegraeumen.
  useEffect(() => {
    const alive = new Set(page.layers.map((layer) => layer.id));
    for (const [layerId, surface] of surfaces) {
      if (!alive.has(layerId)) {
        surface.detach();
        surfaces.delete(layerId);
      }
    }
  }, [page.layers, surfaces]);

  const host = useMemo<InkHost>(
    () => ({
      getPageElement: () => pageRef.current,
      getWetContext: () => wetSurface.getContext(),
      getLayerContext: (layerId) => getSurface(layerId).getContext(),
      getDrawingState: () => ({
        activeLayerId: activeLayerRef.current,
        toolMode: toolRef.current.mode,
        color: toolRef.current.color,
        penWidth: toolRef.current.penWidth,
        eraserWidth: toolRef.current.eraserWidth,
      }),
      onStrokeCommitted: (layerId, stroke) => {
        // Der Strich steht bereits auf dem Canvas – der Surface Bescheid
        // sagen, damit sie ihn beim naechsten Abgleich nicht doppelt zeichnet.
        getSurface(layerId).noteDrawn(stroke.id);
        commitRef.current(layerId, stroke);
      },
    }),
    [getSurface, toolRef, wetSurface],
  );

  useEffect(() => {
    const element = pageRef.current;
    if (!element) return;

    const engine = new InkEngine(host, router);
    const options = { capture: true, passive: false } as const;

    element.addEventListener('pointerdown', engine.handlePointerDown, options);
    element.addEventListener('pointermove', engine.handlePointerMove, options);
    element.addEventListener('pointerup', engine.handlePointerUp, options);
    element.addEventListener('pointercancel', engine.handlePointerCancel, options);
    element.addEventListener('lostpointercapture', engine.handlePointerCancel, options);

    return () => {
      element.removeEventListener('pointerdown', engine.handlePointerDown, options);
      element.removeEventListener('pointermove', engine.handlePointerMove, options);
      element.removeEventListener('pointerup', engine.handlePointerUp, options);
      element.removeEventListener('pointercancel', engine.handlePointerCancel, options);
      element.removeEventListener('lostpointercapture', engine.handlePointerCancel, options);
      engine.dispose();
    };
  }, [host, router]);

  // Zwischen-Canvas anhaengen, sobald die Seite in Blicknaehe ist.
  useEffect(() => {
    const canvas = wetCanvasRef.current;
    if (!canvas) {
      wetSurface.detach();
      return;
    }
    wetSurface.attach(canvas);
    return () => wetSurface.detach();
  }, [isNear, wetSurface]);

  const sortedLayers = useMemo(
    () => [...page.layers].sort((a, b) => a.order - b.order),
    [page.layers],
  );

  return (
    <div className="page-slot">
      <div
        ref={pageRef}
        className={`page${penActive ? ' pen-active' : ''}${isFocused ? ' focused' : ''}`}
        style={{ width: PAGE_WIDTH * zoom, height: PAGE_HEIGHT * zoom }}
        onPointerDownCapture={onFocus}
      >
        <TextLayer
          pageId={page.id}
          initialText={page.text}
          zoom={zoom}
          onChange={onTextChange}
          onEditorReady={onEditorReady}
          onFocus={onFocus}
        />

        {isNear &&
          sortedLayers.map((layer) => (
            <InkLayerCanvas key={layer.id} layer={layer} surface={getSurface(layer.id)} />
          ))}

        {isNear && <canvas ref={wetCanvasRef} className="ink-layer wet-layer" />}
      </div>

      <div className="page-label">
        Seite {pageNumber} / {totalPages}
      </div>
    </div>
  );
});
