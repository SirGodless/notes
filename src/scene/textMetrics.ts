/**
 * Schriftvermessung ueber Canvas measureText()/TextMetrics – nicht ueber
 * CSS "ch" (das ist die Breite der Ziffer "0", kein Zeichenmass: in
 * Proportionalschriften bis zu ~30% daneben, geprueft gegen MDN/Eric
 * Meyers Artikel dazu).
 *
 * Alle Werte werden pro Schriftart+Groesse gecacht, da eine Messung ueber
 * ein ganzes Alphabet nicht gratis ist und sich nicht pro Tastendruck
 * aendert.
 */

export interface FontMetrics {
  /** Mittlere Zeichenbreite in CSS-Pixeln, aus einem repraesentativen Alphabet gemittelt. */
  avgCharWidth: number;
  /** Volle Zeilenhoehe (Ascent+Descent der Schriftart selbst, nicht CSS line-height). */
  lineHeight: number;
}

const SAMPLE_TEXT =
  'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 ßäöü.,;:!?-';

const cache = new Map<string, FontMetrics>();

let sharedCanvas: HTMLCanvasElement | null = null;
function getMeasureContext(): CanvasRenderingContext2D | null {
  if (!sharedCanvas) sharedCanvas = document.createElement('canvas');
  return sharedCanvas.getContext('2d');
}

/**
 * Vermisst eine Schrift (CSS-Font-Kurzschreibweise, z.B. "16px system-ui").
 * Faellt auf eine grobe Schaetzung zurueck, falls der Browser keine
 * fontBoundingBox-Metriken liefert (sehr alte Browser) – siehe
 * MDN TextMetrics-Kompatibilitaet, Chrome 87+/Firefox 116+ haben das, hier
 * also eher eine Absicherung als ein erwarteter Regelfall.
 */
export function measureFont(cssFont: string): FontMetrics {
  const cached = cache.get(cssFont);
  if (cached) return cached;

  const ctx = getMeasureContext();
  if (!ctx) {
    // SSR/Testumgebung ohne Canvas – Notloesung mit Faustregeln.
    const sizeMatch = cssFont.match(/(\d+(?:\.\d+)?)px/);
    const size = sizeMatch ? parseFloat(sizeMatch[1]) : 16;
    const fallback: FontMetrics = { avgCharWidth: size * 0.52, lineHeight: size * 1.3 };
    cache.set(cssFont, fallback);
    return fallback;
  }

  ctx.font = cssFont;
  const sample = ctx.measureText(SAMPLE_TEXT);
  const avgCharWidth = sample.width / SAMPLE_TEXT.length;

  // fontBoundingBoxAscent/Descent beschreiben die Schriftart selbst (nicht
  // nur die tatsaechlich gemessenen Glyphen) – das ist die richtige Basis
  // fuer eine Zeilenhoehe, die auch fuer Zeichen ohne Ober-/Unterlaengen
  // im Sample-Text stimmt.
  const hasFontBox = sample.fontBoundingBoxAscent !== undefined;
  const sizeMatch = cssFont.match(/(\d+(?:\.\d+)?)px/);
  const size = sizeMatch ? parseFloat(sizeMatch[1]) : 16;
  const lineHeight = hasFontBox
    ? sample.fontBoundingBoxAscent + sample.fontBoundingBoxDescent
    : size * 1.3;

  const metrics: FontMetrics = { avgCharWidth, lineHeight };
  cache.set(cssFont, metrics);
  return metrics;
}

/** measureChars (Zielbreite in echten Zeichen) -> CSS-Pixel-Breite fuer die gegebene Schrift. */
export function charsToPixelWidth(measureChars: number, cssFont: string): number {
  return measureFont(cssFont).avgCharWidth * measureChars;
}
