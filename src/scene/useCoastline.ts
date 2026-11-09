/**
 * Berechnet die Kuestenlinie einer Insel aus ihrem aktuellen Inhalt, debounced
 * statt synchron bei jeder Aenderung – "laeuft nur bei coastlineDirty,
 * gedrosselt" (Plan). Ein Strich committed zwar nur bei pointerup (nicht pro
 * Punkt), aber waehrend einer laengeren Zeichensitzung waeren mehrere
 * Neuberechnungen pro Sekunde trotzdem unnoetige Arbeit fuer eine Kontur, die
 * sich visuell kaum merklich aendert.
 */

import { useEffect, useRef, useState } from 'react';
import { boundsOf, unionOfBounds, type Bounds } from '../ink/geometry';
import type { TextBox } from '../model/island';
import type { InkLayer } from '../model/types';
import { BODY_CSS_FONT, estimateContentBlockCount, getGridSpacing } from './baselineGrid';
import { computeCoastline, type CoastlineResult } from './coastline';
import { charsToPixelWidth } from './textMetrics';

/** Wartezeit nach der letzten Inhaltsaenderung, bevor neu berechnet wird. */
const RECOMPUTE_DEBOUNCE_MS = 400;

/**
 * CoastlineResult.bounds ist die Bounding-Box der FERTIGEN (bereits um
 * KUESTENABSTAND aufgeblähten + gegltteten) Kontur – fuer die Rand/Mitte-
 * Unterscheidung beim Drag&Drop (siehe ownership.ts containsScreenPointInterior)
 * braucht es aber die Bounding-Box des ROHEN Inhalts (Striche/Textboxen VOR
 * der Aufblähung), sonst waere "Mitte" praktisch deckungsgleich mit "ueberhaupt
 * auf der Insel" und ein Rand-Drop (Merge) koennte nie zustande kommen.
 */
export interface CoastlineWithContentBounds extends CoastlineResult {
  contentBounds: Bounds | null;
}

const EMPTY: CoastlineWithContentBounds = { loops: [], bounds: null, contentBounds: null, containsPoint: () => false };

function strokeRectsOf(layers: readonly InkLayer[]): Bounds[] {
  const rects: Bounds[] = [];
  for (const layer of layers) {
    for (const stroke of layer.strokes) {
      const bounds = boundsOf(stroke.points, stroke.width / 2 + 1);
      if (bounds) rects.push(bounds);
    }
  }
  return rects;
}

/**
 * Rechtecke aus Textboxen – siehe Plan, Abschnitt "Kuestenlinie": eine
 * Insel, die nur Text und keine Tinte enthaelt, braucht trotzdem eine
 * Kontur. Hoehe ist eine grobe Schaetzung (siehe estimateContentBlockCount),
 * keine echte DOM-Messung – fuer die Kontur (die ohnehin mit KUESTENABSTAND
 * aufblaeht) reicht das.
 */
function textBoxRectsOf(textBoxes: readonly TextBox[]): Bounds[] {
  const grid = getGridSpacing();
  return textBoxes.map((textBox) => {
    const width = charsToPixelWidth(textBox.measureChars, BODY_CSS_FONT);
    const height = estimateContentBlockCount(textBox.content) * grid;
    return { minX: textBox.x, minY: textBox.y, maxX: textBox.x + width, maxY: textBox.y + height };
  });
}

export function useCoastline(
  islandId: string,
  layers: readonly InkLayer[],
  textBoxes: readonly TextBox[],
): CoastlineWithContentBounds {
  const [result, setResult] = useState<CoastlineWithContentBounds>(EMPTY);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Signatur statt der Array-Referenz: dieselbe Lehre wie bei den Kachel-
  // Effekten in IslandView – `layers`/`textBoxes` aendern ihre Referenz bei
  // jeder Aenderung, aber ein reiner Signatur-Vergleich verhindert unnoetige
  // Timer-Resets, wenn sich inhaltlich nichts geaendert hat (z.B. bei einem
  // Rerender aus anderem Grund). Fuer Textboxen zaehlt nur Position/Breite/
  // Blockanzahl, nicht der volle Text – ein Tastendruck ohne neue Zeile
  // soll die Kontur nicht neu anstossen.
  const signature =
    layers
      .map((layer) => `${layer.id}:${layer.strokes.length}:${layer.strokes[layer.strokes.length - 1]?.id ?? ''}`)
      .join('|') +
    '~' +
    textBoxes
      .map((tb) => `${tb.id}:${tb.x}:${tb.y}:${tb.measureChars}:${estimateContentBlockCount(tb.content)}`)
      .join('|');

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      const rects = [...strokeRectsOf(layers), ...textBoxRectsOf(textBoxes)];
      if (rects.length === 0) {
        setResult(EMPTY);
        return;
      }
      setResult({ ...computeCoastline(rects, islandId), contentBounds: unionOfBounds(rects) });
    }, RECOMPUTE_DEBOUNCE_MS);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [islandId, signature]);

  return result;
}
