import { getRenderScale } from '../config';
import type { InkLayer } from '../model/types';
import { clearContext, prepareCanvas, renderStroke } from './renderer';

/**
 * Verbindet ein <canvas> mit der Strichliste einer Ebene.
 *
 * Der wichtige Teil ist `sync`: nach jedem neuen Strich wuerde ein naiver
 * "Canvas leeren und alles neu zeichnen"-Ansatz den Aufwand quadratisch
 * wachsen lassen – bei 1000 Strichen waeren das 500.000 gezeichnete Striche
 * ueber die Sitzung. Deshalb merkt sich die Surface, was schon auf dem Canvas
 * steht, und zeichnet normalerweise nur das Neue nach.
 *
 * Komplett neu aufgebaut wird nur, wenn die Strichliste sich nicht als reine
 * Verlaengerung des bereits Gezeichneten erklaeren laesst – also nach Undo,
 * beim Laden einer Datei oder wenn die Aufloesung sich aendert.
 */
export class LayerSurface {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private drawnIds: string[] = [];

  attach(canvas: HTMLCanvasElement): void {
    if (this.canvas === canvas && this.ctx) return;
    this.canvas = canvas;
    this.ctx = prepareCanvas(canvas, getRenderScale());
    // Frisches Canvas – alles, was wir zu wissen glaubten, ist hinfaellig.
    this.drawnIds = [];
  }

  detach(): void {
    this.canvas = null;
    this.ctx = null;
    this.drawnIds = [];
  }

  getContext(): CanvasRenderingContext2D | null {
    return this.ctx;
  }

  /**
   * Meldet, dass ein Strich bereits live aufs Canvas gezeichnet wurde.
   * Verhindert, dass `sync` ihn gleich darauf ein zweites Mal zeichnet.
   */
  noteDrawn(strokeId: string): void {
    this.drawnIds.push(strokeId);
  }

  sync(layer: InkLayer): void {
    const ctx = this.ctx;
    if (!ctx) return;

    if (this.isPrefixOfDrawn(layer)) {
      for (let i = this.drawnIds.length; i < layer.strokes.length; i++) {
        renderStroke(ctx, layer.strokes[i]);
        this.drawnIds.push(layer.strokes[i].id);
      }
      ctx.globalCompositeOperation = 'source-over';
      return;
    }

    this.redraw(layer);
  }

  /** Erzwingt kompletten Neuaufbau (Undo, Datei laden, Aufloesungswechsel). */
  redraw(layer: InkLayer): void {
    const ctx = this.ctx;
    if (!ctx) return;

    clearContext(ctx);
    for (const stroke of layer.strokes) {
      renderStroke(ctx, stroke);
    }
    ctx.globalCompositeOperation = 'source-over';
    this.drawnIds = layer.strokes.map((stroke) => stroke.id);
  }

  /** Ist das bereits Gezeichnete ein Anfangsstueck der aktuellen Strichliste? */
  private isPrefixOfDrawn(layer: InkLayer): boolean {
    if (this.drawnIds.length > layer.strokes.length) return false;
    for (let i = 0; i < this.drawnIds.length; i++) {
      if (this.drawnIds[i] !== layer.strokes[i].id) return false;
    }
    return true;
  }
}

/** Das Zwischen-Canvas fuer den gerade laufenden Strich. */
export class WetSurface {
  private ctx: CanvasRenderingContext2D | null = null;

  attach(canvas: HTMLCanvasElement): void {
    this.ctx = prepareCanvas(canvas, getRenderScale());
  }

  detach(): void {
    this.ctx = null;
  }

  getContext(): CanvasRenderingContext2D | null {
    return this.ctx;
  }

  clear(): void {
    if (this.ctx) clearContext(this.ctx);
  }
}
