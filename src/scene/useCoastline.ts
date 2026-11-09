/**
 * Berechnet die Kuestenlinie einer Insel aus ihrem aktuellen Inhalt, debounced
 * statt synchron bei jeder Aenderung – "laeuft nur bei coastlineDirty,
 * gedrosselt" (Plan). Ein Strich committed zwar nur bei pointerup (nicht pro
 * Punkt), aber waehrend einer laengeren Zeichensitzung waeren mehrere
 * Neuberechnungen pro Sekunde trotzdem unnoetige Arbeit fuer eine Kontur, die
 * sich visuell kaum merklich aendert.
 */

import { useEffect, useRef, useState } from 'react';
import { boundsOf, type Bounds } from '../ink/geometry';
import type { InkLayer } from '../model/types';
import { computeCoastline, type CoastlineResult } from './coastline';

/** Wartezeit nach der letzten Inhaltsaenderung, bevor neu berechnet wird. */
const RECOMPUTE_DEBOUNCE_MS = 400;

const EMPTY: CoastlineResult = { loops: [], bounds: null, containsPoint: () => false };

function contentRectsOf(layers: readonly InkLayer[]): Bounds[] {
  const rects: Bounds[] = [];
  for (const layer of layers) {
    for (const stroke of layer.strokes) {
      const bounds = boundsOf(stroke.points, stroke.width / 2 + 1);
      if (bounds) rects.push(bounds);
    }
  }
  return rects;
}

export function useCoastline(islandId: string, layers: readonly InkLayer[]): CoastlineResult {
  const [result, setResult] = useState<CoastlineResult>(EMPTY);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Signatur statt der Array-Referenz: dieselbe Lehre wie bei den Kachel-
  // Effekten in IslandView – `layers` aendert ihre Referenz bei jedem Strich,
  // aber ein reiner Signatur-Vergleich verhindert unnoetige Timer-Resets,
  // wenn sich inhaltlich nichts geaendert hat (z.B. bei einem Rerender aus
  // anderem Grund).
  const signature = layers
    .map((layer) => `${layer.id}:${layer.strokes.length}:${layer.strokes[layer.strokes.length - 1]?.id ?? ''}`)
    .join('|');

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      const rects = contentRectsOf(layers);
      setResult(rects.length > 0 ? computeCoastline(rects, islandId) : EMPTY);
    }, RECOMPUTE_DEBOUNCE_MS);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [islandId, signature]);

  return result;
}
