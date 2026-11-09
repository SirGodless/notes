/**
 * Miniatur-Cache fuer weit herausgezoomte Inseln (siehe Plan, Abschnitt
 * "Miniatur-Cache fuers Herauszoomen"). Rein im Speicher (nicht persistiert) –
 * eine neu geladene Seite rendert die Miniaturen beim ersten Bedarf neu,
 * was fuer eine Einzelnutzer-App unkritisch ist.
 *
 * Vereinfachung gegenueber dem Plan: eine Miniatur zeigt nur den EIGENEN
 * Inhalt der Insel (Striche + grobe Textbox-Flecken), nicht rekursiv auch
 * den ihrer Kind-Inseln – jede Kind-Insel ist ein eigener DOM-Knoten mit
 * eigenem isNear/Miniatur-Kreislauf, eine echte Kompositierung waere ein
 * eigenes Stueck Arbeit. Das thumbnailStale-Flag propagiert trotzdem wie
 * im Plan beschrieben den Baum hoch (siehe SeaView.markThumbnailStale) –
 * eine spaetere Stufe koennte das fuer eine echte rekursive Miniatur nutzen.
 */

import { PAGE_HEIGHT, PAGE_WIDTH } from '../config';
import { prepareCanvas, renderLayer } from '../ink/renderer';
import type { IslandManifest } from '../model/island';
import { BODY_CSS_FONT, estimateContentBlockCount, getGridSpacing } from './baselineGrid';
import { charsToPixelWidth } from './textMetrics';

/** Rund 1/8 der echten Seitengroesse – fuer eine Vorschau mehr als genug Aufloesung. */
const THUMBNAIL_WIDTH = Math.round(PAGE_WIDTH / 8);
const THUMBNAIL_SCALE = THUMBNAIL_WIDTH / PAGE_WIDTH;
const THUMBNAIL_HEIGHT = Math.round(PAGE_HEIGHT * THUMBNAIL_SCALE);

/** Rendert eine Insel (nur eigener Inhalt, siehe Modul-Kommentar) zu einer data:-URL. */
export function renderThumbnail(island: IslandManifest): string {
  const canvas = document.createElement('canvas');
  const ctx = prepareCanvas(canvas, THUMBNAIL_SCALE, PAGE_WIDTH, PAGE_HEIGHT);
  if (!ctx) return '';

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT);
  ctx.restore();

  for (const layer of [...island.layers].sort((a, b) => a.order - b.order)) {
    if (!layer.visible) continue;
    renderLayer(ctx, layer);
  }

  // Textboxen: keine echte Glyphen-Darstellung (zu teuer fuer eine Miniatur),
  // nur ein grauer Fleck an Position/Groesse – reicht, um auf diesem
  // Zoom-Level "hier ist Text" zu signalisieren.
  ctx.fillStyle = 'rgba(100, 100, 100, 0.35)';
  const grid = getGridSpacing();
  for (const textBox of island.textBoxes) {
    const width = charsToPixelWidth(textBox.measureChars, BODY_CSS_FONT);
    const height = estimateContentBlockCount(textBox.content) * grid;
    ctx.fillRect(textBox.x, textBox.y, width, height);
  }

  return canvas.toDataURL('image/png');
}
