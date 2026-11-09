/**
 * Setzt die berechneten Grundlinienraster-Werte einmalig als CSS Custom
 * Properties auf :root – styles.css referenziert sie darueber, statt dass
 * jede Textbox ihre eigenen Inline-Styles fuer Zeilenhoehe berechnen muss.
 */

import { computeBlockRhythm, getGridSpacing } from './baselineGrid';

let applied = false;

export function applyGridRhythm(): void {
  if (applied) return;
  applied = true;

  const rhythm = computeBlockRhythm();
  const root = document.documentElement.style;

  root.setProperty('--grid-spacing', `${getGridSpacing()}px`);
  root.setProperty('--rhythm-p-size', `${rhythm.paragraph.fontSize}px`);
  root.setProperty('--rhythm-p-line', `${rhythm.paragraph.lineHeight}px`);
  for (const level of [1, 2, 3] as const) {
    root.setProperty(`--rhythm-h${level}-size`, `${rhythm.heading[level].fontSize}px`);
    root.setProperty(`--rhythm-h${level}-line`, `${rhythm.heading[level].lineHeight}px`);
  }
}
