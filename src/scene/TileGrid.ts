/**
 * Kachel-Raster fuer EINE Ink-Ebene (einer Insel oder des Meeres).
 *
 * Ersetzt v1s LayerSurface. Kernidee unveraendert: nur Kacheln im Viewport
 * bekommen ueberhaupt ein Canvas, damit der Speicherbedarf an der
 * Bildschirmflaeche haengt statt am Inhalt (siehe Plan, Abschnitt "Kacheln").
 *
 * Kachelgroesse ist FEST IN WELTEINHEITEN (nicht in Geraete-Pixeln) – sonst
 * wuerde sich bei jedem Zoomschritt die gesamte Kachel-Indizierung
 * veraendern. Die Geraete-Pixel-Groesse einer Kachel ergibt sich aus
 * TILE_WORLD_SIZE * renderScale und wandert damit mit dem Zoom; genau das
 * ist der Mechanismus, ueber den "Kacheln werden bei Zoom-Schwellen neu
 * gerendert" (Plan) tatsaechlich passiert.
 *
 * Reihenfolge ist entscheidend: eine Kachel wird aus der VOLLEN, geordneten
 * Strichliste der Ebene gefiltert und in dieser Reihenfolge gezeichnet –
 * genau wie v1s LayerSurface.redraw(). Das ist unverzichtbar, weil
 * Radierer-Striche (destination-out) nur auf das wirken duerfen, was vor
 * ihnen in der Liste stand.
 */

import { getRenderScale } from '../config';
import { boundsOf, rectsOverlap, type Bounds } from '../ink/geometry';
import { clearContext, prepareCanvas, renderStroke, StrokePainter } from '../ink/renderer';
import type { Stroke } from '../model/types';

/** Welteinheiten pro Kachelseite. Siehe Kommentar oben zur Begruendung. */
export const TILE_WORLD_SIZE = 512;

interface Tile {
  tx: number;
  ty: number;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  /** Welt-Rechteck, das diese Kachel abdeckt (fuer Ueberlappungstests). */
  bounds: Bounds;
}

function tileKey(tx: number, ty: number): string {
  return `${tx},${ty}`;
}

function tileWorldBounds(tx: number, ty: number): Bounds {
  return {
    minX: tx * TILE_WORLD_SIZE,
    minY: ty * TILE_WORLD_SIZE,
    maxX: (tx + 1) * TILE_WORLD_SIZE,
    maxY: (ty + 1) * TILE_WORLD_SIZE,
  };
}

/** Zwischenspeicher der Huellrechtecke aller Striche einer Ebene. */
class StrokeBoundsCache {
  private cache = new Map<string, Bounds | null>();

  get(stroke: Stroke): Bounds | null {
    let bounds = this.cache.get(stroke.id);
    if (bounds === undefined) {
      bounds = boundsOf(stroke.points, stroke.width / 2 + 1);
      this.cache.set(stroke.id, bounds);
    }
    return bounds;
  }

  forget(strokeId: string): void {
    this.cache.delete(strokeId);
  }

  clear(): void {
    this.cache.clear();
  }
}

export class TileGrid {
  private tiles = new Map<string, Tile>();
  private boundsCache = new StrokeBoundsCache();
  private renderScale = getRenderScale();
  private container: HTMLElement | null = null;

  /** Liefert die aktuell im Speicher gehaltenen Kacheln (fuer Debug/Tests). */
  get mountedCount(): number {
    return this.tiles.size;
  }

  /**
   * Legt fest, in welches DOM-Element neu erzeugte Kachel-Canvases gehaengt
   * werden. React rendert hier bewusst nichts deklarativ hinein (kein JSX
   * pro Kachel) – Kacheln kommen und gehen zu haeufig beim Pannen, um das
   * ueber den React-Reconciler laufen zu lassen. Gleiches Prinzip wie v1s
   * LayerSurface.attach() fuer ein einzelnes Canvas, nur fuer viele.
   */
  attach(container: HTMLElement): void {
    this.container = container;
  }

  /** Haengt alle Kacheln aus und vergisst das Container-Element. */
  detach(): void {
    this.dispose();
    this.container = null;
  }

  /**
   * Stellt sicher, dass genau die Kacheln existieren, die `visibleWorldRect`
   * (plus etwas Rand) ueberdecken. Neue Kacheln werden aus `strokes`
   * aufgebaut (gefiltert + in Reihenfolge gezeichnet), ueberzaehlige werden
   * freigegeben.
   */
  sync(visibleWorldRect: Bounds, strokes: readonly Stroke[], marginTiles = 1): void {
    const minTx = Math.floor(visibleWorldRect.minX / TILE_WORLD_SIZE) - marginTiles;
    const maxTx = Math.floor(visibleWorldRect.maxX / TILE_WORLD_SIZE) + marginTiles;
    const minTy = Math.floor(visibleWorldRect.minY / TILE_WORLD_SIZE) - marginTiles;
    const maxTy = Math.floor(visibleWorldRect.maxY / TILE_WORLD_SIZE) + marginTiles;

    const needed = new Set<string>();
    for (let tx = minTx; tx <= maxTx; tx++) {
      for (let ty = minTy; ty <= maxTy; ty++) {
        const key = tileKey(tx, ty);
        needed.add(key);
        if (!this.tiles.has(key)) this.mountTile(tx, ty, strokes);
      }
    }

    for (const [key, tile] of this.tiles) {
      if (!needed.has(key)) {
        tile.canvas.remove();
        this.tiles.delete(key);
      }
    }
  }

  /** Erzwingt Neuaufbau aller gemounteten Kacheln (z.B. nach Undo oder Zoom-Schwelle). */
  rebuildAll(strokes: readonly Stroke[]): void {
    this.boundsCache.clear();
    for (const tile of this.tiles.values()) {
      this.paintTile(tile, strokes);
    }
  }

  /** Setzt die Render-Aufloesung; bei Aenderung werden alle Kacheln neu aufgebaut. */
  setRenderScale(scale: number, strokes: readonly Stroke[]): void {
    if (scale === this.renderScale) return;
    this.renderScale = scale;
    for (const tile of this.tiles.values()) {
      prepareCanvas(tile.canvas, scale, TILE_WORLD_SIZE, TILE_WORLD_SIZE);
    }
    this.rebuildAll(strokes);
  }

  /**
   * Malt einen fertigen PEN-Strich in jede aktuell gemountete Kachel, die er
   * beruehrt. Wird einmal bei pointerup aufgerufen (siehe
   * IslandInkController) – waehrend des Zeichnens laeuft die Tinte auf
   * einem ungekachelten Wet-Canvas (siehe WetCanvas), nicht hier.
   *
   * NICHT fuer Radierer-Striche aufrufen: deren Live-Pfad
   * (TiledErasePainters) hat die betroffenen Kacheln bereits waehrend der
   * Geste gemalt, ein zweiter Aufruf hier waere nur verschwendete Arbeit.
   */
  commitStroke(stroke: Stroke): void {
    const bounds = this.boundsCache.get(stroke);
    if (!bounds) return;
    for (const tile of this.tiles.values()) {
      if (rectsOverlap(tile.bounds, bounds)) renderStroke(tile.ctx, stroke);
    }
  }

  /** Muss bei Undo/Entfernen eines Strichs gerufen werden, sonst bleibt ein Cache-Eintrag haengen. */
  forgetStroke(strokeId: string): void {
    this.boundsCache.forget(strokeId);
  }

  /**
   * Fuer den Radiergummi: liefert die gemounteten Kacheln, deren
   * Welt-Rechteck sich mit `bounds` ueberschneidet – damit ein laufender
   * Radierstrich live auf alle betroffenen Kacheln wirkt, nicht erst beim
   * Loslassen. Siehe IslandInkController.
   */
  getMountedTilesOverlapping(bounds: Bounds): CanvasRenderingContext2D[] {
    const result: CanvasRenderingContext2D[] = [];
    for (const tile of this.tiles.values()) {
      if (rectsOverlap(tile.bounds, bounds)) result.push(tile.ctx);
    }
    return result;
  }

  dispose(): void {
    for (const tile of this.tiles.values()) tile.canvas.remove();
    this.tiles.clear();
    this.boundsCache.clear();
  }

  private mountTile(tx: number, ty: number, strokes: readonly Stroke[]): void {
    if (!this.container) return;

    const canvas = document.createElement('canvas');
    const ctx = prepareCanvas(canvas, this.renderScale, TILE_WORLD_SIZE, TILE_WORLD_SIZE);
    if (!ctx) return;

    // CSS-Groesse der Kachel ist IMMER TILE_WORLD_SIZE px, unabhaengig vom
    // Zoom – der Zoom wird einmalig weiter oben in der Transform-Kette
    // angewendet (siehe scene/SeaView), nicht pro Kachel.
    canvas.className = 'ink-tile';
    canvas.style.position = 'absolute';
    canvas.style.left = `${tx * TILE_WORLD_SIZE}px`;
    canvas.style.top = `${ty * TILE_WORLD_SIZE}px`;
    canvas.style.width = `${TILE_WORLD_SIZE}px`;
    canvas.style.height = `${TILE_WORLD_SIZE}px`;
    canvas.style.pointerEvents = 'none';
    this.container.appendChild(canvas);

    const tile: Tile = { tx, ty, canvas, ctx, bounds: tileWorldBounds(tx, ty) };
    this.tiles.set(tileKey(tx, ty), tile);
    this.paintTile(tile, strokes);
  }

  private paintTile(tile: Tile, strokes: readonly Stroke[]): void {
    clearContext(tile.ctx);
    // ctx.setTransform bildet bislang Welt-Ursprung (0,0) auf Canvas-Pixel
    // (0,0) ab (siehe prepareCanvas/renderer.ts). Fuer eine Kachel muss der
    // Welt-Ursprung der Kachel selbst auf Pixel (0,0) wandern – deshalb hier
    // zusaetzlich um -tileOriginWorld verschieben, VOR dem eigentlichen Malen.
    const scale = this.renderScale;
    tile.ctx.setTransform(scale, 0, 0, scale, -tile.bounds.minX * scale, -tile.bounds.minY * scale);

    for (const stroke of strokes) {
      const bounds = this.boundsCache.get(stroke);
      if (bounds && rectsOverlap(bounds, tile.bounds)) renderStroke(tile.ctx, stroke);
    }
    // Falls der letzte gezeichnete Strich ein Radierer war, bliebe sonst
    // destination-out aktiv, bis der naechste applyStrokeStyle()-Aufruf es
    // ueberschreibt – externe Leser des Contexts saehen zwischenzeitlich den
    // falschen Modus. Gleiches Muster wie renderLayer()/LayerSurface.redraw().
    tile.ctx.globalCompositeOperation = 'source-over';
  }
}

/**
 * Hilfsfunktion fuer den Live-Teil des Radiergummis: fuehrt pro Kachel einen
 * eigenen StrokePainter nach, der denselben (wachsenden) Punkte-Array malt.
 * Jeder Painter verfolgt seinen Fortschritt selbst (StrokePainter.piecesDrawn
 * ist Instanzzustand), deshalb ist "ein Painter pro beruehrter Kachel,
 * dauerhaft fuer die Geste" korrekt – auch wenn der Radierer eine Kachel
 * kurz verlaesst und zurueckkommt, bleibt ihr Painter gueltig.
 */
export class TiledErasePainters {
  private painters = new Map<CanvasRenderingContext2D, StrokePainter>();

  ensureFor(ctx: CanvasRenderingContext2D, stroke: Stroke): StrokePainter {
    let painter = this.painters.get(ctx);
    if (!painter) {
      painter = new StrokePainter(ctx, stroke);
      this.painters.set(ctx, painter);
    }
    return painter;
  }

  drawPendingAll(): void {
    for (const painter of this.painters.values()) painter.drawPending();
  }

  /**
   * Schliesst alle beteiligten Painter UND setzt deren
   * globalCompositeOperation zurueck (close() selbst tut das nicht – siehe
   * renderer.ts applyStrokeStyle, das nur VOR einem Zeichenaufruf gesetzt
   * wird). Ohne das bliebe nach einem Radierstrich destination-out auf
   * jeder beteiligten Kachel aktiv.
   */
  closeAll(): void {
    for (const [ctx, painter] of this.painters) {
      painter.close();
      ctx.globalCompositeOperation = 'source-over';
    }
  }
}
