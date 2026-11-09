/**
 * Globales Grundlinienraster mit InDesign-artiger Sprungregel: jede Zeile
 * will auf der naechsten freien Rasterlinie sitzen; passt eine Zeile nicht
 * in eine Rasterzeile (grosse Ueberschrift), springt sie auf die naechste
 * Linie, die genug Hoehe bietet – die uebersprungenen Linien bleiben fuer
 * DIESE Zeile ungenutzt, danach rastert es wieder normal weiter.
 *
 * Umsetzung bewusst rein ueber CSS line-height + genullte Margins
 * ("vertical rhythm", klassische Satztechnik) statt ueber Javascript, das
 * pro sichtbarer Zeile im gerenderten contenteditable misst: robuster
 * (funktioniert bei jedem Reflow automatisch mit) und ohne Messschleife
 * bei jedem Tastendruck.
 *
 * Vereinfachung gegenueber "nur die erste Zeile einer Ueberschrift
 * ueberspringt, der Rest der Ueberschrift rastert normal": hier bekommt
 * JEDE Zeile eines Blocks dieselbe (groessere) Zeilenhoehe. Fuer die in
 * der Praxis fast immer einzeiligen Ueberschriften ist das nicht von der
 * "nur erste Zeile"-Variante zu unterscheiden; bei einer mehrzeiligen
 * Ueberschrift wirkt der Sprung bei jeder ihrer Zeilen, nicht nur der
 * ersten – ein bewusst in Kauf genommener Approximationsfehler.
 *
 * Bekannte Einschraenkung (siehe Plan): zuverlaessig nur auf der obersten
 * Ebene und bei nicht-reskalierten Inseln; bei spaeter reskalierten
 * Kind-Inseln ist die Ausrichtung best-effort, da das Raster in
 * Weltkoordinaten lebt, nicht in der lokalen Skalierung der Kind-Insel.
 */

import type { TextDoc } from '../model/types';
import { measureFont } from './textMetrics';

export const BODY_FONT_SIZE = 16;
export const HEADING_FONT_SIZES: Record<1 | 2 | 3, number> = { 1: 30, 2: 24, 3: 19 };
const FONT_FAMILY = 'system-ui, -apple-system, sans-serif';

function cssFont(size: number): string {
  return `${size}px ${FONT_FAMILY}`;
}

/** Einzige Quelle fuer die Grundschrift als CSS-Font-Kurzschreibweise – von TextBoxView und useCoastline geteilt. */
export const BODY_CSS_FONT = cssFont(BODY_FONT_SIZE);

/**
 * Grobe Hoehen-Schaetzung einer Textbox fuer die Kuestenlinie (siehe
 * useCoastline.ts) – eine Zeile pro Top-Level-Block (Absatz/Ueberschrift),
 * nicht die tatsaechliche Wortumbruch-Zeilenzahl. Unterschaetzt mehrzeilige
 * Absaetze; fuer die Kuestenlinie (die ohnehin mit KUESTENABSTAND aufbläht
 * und nur grob "hier ist Inhalt" markieren muss) ausreichend.
 */
export function estimateContentBlockCount(content: TextDoc): number {
  const blocks = (content as { content?: unknown[] }).content;
  return Array.isArray(blocks) && blocks.length > 0 ? blocks.length : 1;
}

/** Rasterabstand = natuerliche Zeilenhoehe der Grundschrift, einmal berechnet. */
let cachedGridSpacing: number | null = null;
export function getGridSpacing(): number {
  if (cachedGridSpacing === null) {
    cachedGridSpacing = measureFont(cssFont(BODY_FONT_SIZE)).lineHeight;
  }
  return cachedGridSpacing;
}

/** Zeilenhoehe fuer einen Blocktyp, aufgerundet auf das naechste Vielfache des Rasterabstands. */
function gridLineHeightFor(fontSize: number): number {
  const grid = getGridSpacing();
  const natural = measureFont(cssFont(fontSize)).lineHeight;
  return Math.ceil(natural / grid) * grid;
}

export interface BlockRhythm {
  fontSize: number;
  lineHeight: number;
}

/** CSS-Werte fuer Absatz- und Ueberschriften-Bloecke, Grundlinienraster-konform. */
export function computeBlockRhythm(): { paragraph: BlockRhythm; heading: Record<1 | 2 | 3, BlockRhythm> } {
  return {
    paragraph: { fontSize: BODY_FONT_SIZE, lineHeight: gridLineHeightFor(BODY_FONT_SIZE) },
    heading: {
      1: { fontSize: HEADING_FONT_SIZES[1], lineHeight: gridLineHeightFor(HEADING_FONT_SIZES[1]) },
      2: { fontSize: HEADING_FONT_SIZES[2], lineHeight: gridLineHeightFor(HEADING_FONT_SIZES[2]) },
      3: { fontSize: HEADING_FONT_SIZES[3], lineHeight: gridLineHeightFor(HEADING_FONT_SIZES[3]) },
    },
  };
}
