import { memo, useEffect, useRef } from 'react';
import type { LayerSurface } from '../ink/LayerSurface';
import type { InkLayer } from '../model/types';

interface InkLayerCanvasProps {
  layer: InkLayer;
  surface: LayerSurface;
}

/**
 * Ein Canvas pro Ink-Ebene, absolut ueber dem Text.
 *
 * Die Komponente zeichnet selbst nichts, sie haengt nur das Canvas an seine
 * LayerSurface. Die entscheidet dann, ob ein neuer Strich angehaengt oder die
 * Ebene komplett neu aufgebaut werden muss.
 *
 * Unsichtbare Ebenen werden per display:none ausgeblendet statt ausgehaengt –
 * so ist das Ein- und Ausblenden sofort da und kostet kein Neuzeichnen.
 */
export const InkLayerCanvas = memo(function InkLayerCanvas({ layer, surface }: InkLayerCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    surface.attach(canvas);
    surface.redraw(layer);

    return () => surface.detach();
    // Absichtlich nur `surface`: das Anhaengen soll einmal passieren, nicht
    // bei jeder Strich-Aenderung. Das Nachziehen uebernimmt der Effekt darunter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [surface]);

  useEffect(() => {
    surface.sync(layer);
  }, [surface, layer]);

  return (
    <canvas
      ref={canvasRef}
      className="ink-layer"
      style={{
        zIndex: 10 + layer.order,
        display: layer.visible ? 'block' : 'none',
      }}
    />
  );
});
