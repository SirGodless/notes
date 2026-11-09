/**
 * Die v2-Entsprechung von v1s InkEngine – fuer eine Insel (oder das Meer),
 * deren Ebenen jetzt als TileGrid statt als Einzel-Canvas vorliegen.
 *
 * Pointer-Choreographie, Palm-Rejection-Anbindung und Druckerkennung sind
 * absichtlich identisch zu InkEngine.ts gehalten – wer die eine Datei
 * versteht, erkennt die andere wieder. Was sich aendert, ist NUR, wohin
 * gezeichnet wird:
 *
 *  - Stift: wie in v1 erst auf ein ungekacheltes Wet-Canvas (schnell, ein
 *    einzelner Painter), beim Abheben einmalig in alle betroffenen Kacheln
 *    uebertragen (TileGrid.commitStroke).
 *  - Radiergummi: MUSS live auf die echten Kacheln wirken (destination-out
 *    braucht die bereits vorhandenen Pixel), nicht auf ein leeres
 *    Wet-Canvas. Da ein Radierstrich mehrere Kacheln ueberstreichen kann,
 *    gibt es hier – anders als in v1, wo eine Ebene ein einzelnes Canvas
 *    war – pro beruehrter Kachel einen eigenen Painter (TiledErasePainters).
 */

import { MIN_POINT_DISTANCE } from '../config';
import type { Bounds } from '../ink/geometry';
import { boundsOf, clamp, distance } from '../ink/geometry';
import { beginInputGesture, endInputGesture } from '../ink/inputActivity';
import type { PointerRouter, ToolMode } from '../ink/pointerRouter';
import { PressureProbe, smoothPressure } from '../ink/pressure';
import { clearContext, StrokePainter } from '../ink/renderer';
import { createStroke } from '../model/factory';
import type { Stroke, StrokePoint, ToolKind } from '../model/types';
import { TiledErasePainters, type TileGrid } from './TileGrid';

export interface IslandInkHost {
  /** Das DOM-Element der Insel selbst – sein Rect spannt den Insel-lokalen Raum auf. */
  getIslandElement(): HTMLElement | null;
  /** Insel-lokale Groesse in Welteinheiten (Stage B: fest, siehe IslandView). */
  getWorldSize(): { width: number; height: number };
  /** Ungekacheltes Zwischen-Canvas fuer den gerade laufenden Stift-Strich. */
  getWetContext(): CanvasRenderingContext2D | null;
  /** Kachel-Raster der angegebenen Ebene. */
  getTileGrid(layerId: string): TileGrid | null;
  getDrawingState(): {
    activeLayerId: string | null;
    toolMode: ToolMode;
    color: string;
    penWidth: number;
    eraserWidth: number;
  };
  onStrokeCommitted(layerId: string, stroke: Stroke): void;
}

interface ActiveStroke {
  stroke: Stroke;
  layerId: string;
  tileGrid: TileGrid;
  pointerId: number;
  startedAt: number;
  smoothedPressure: number | null;
  /** Nur bei tool === 'pen' gesetzt. */
  wetPainter: StrokePainter | null;
  /** Nur bei tool === 'eraser' gesetzt – ein Painter pro beruehrter Kachel. */
  erasePainters: TiledErasePainters | null;
}

export class IslandInkController {
  private readonly pressureProbe = new PressureProbe();
  private active: ActiveStroke | null = null;

  constructor(
    private readonly host: IslandInkHost,
    private readonly router: PointerRouter,
  ) {}

  dispose(): void {
    this.abort();
  }

  get isDrawing(): boolean {
    return this.active !== null;
  }

  // -------------------------------------------------------------------------
  // Pointer-Handler – siehe ink/InkEngine.ts fuer die ausfuehrliche
  // Begruendung der Reihenfolge (preventDefault/stopPropagation vor jedem
  // Scroll-/Cursor-Nebeneffekt, getCoalescedEvents fuer volle Praezision).
  // -------------------------------------------------------------------------

  handlePointerDown = (event: PointerEvent): void => {
    if (event.pointerType === 'pen') this.router.notePenActivity(event.pointerId, true);

    const { toolMode } = this.host.getDrawingState();
    const verdict = this.router.decide(event, toolMode);
    if (verdict.action === 'passthrough') return;

    event.preventDefault();
    event.stopPropagation();
    if (verdict.action === 'swallow') return;

    this.beginStroke(event, verdict.tool);
  };

  handlePointerMove = (event: PointerEvent): void => {
    if (event.pointerType === 'pen') {
      this.router.notePenActivity(event.pointerId, this.active !== null);
    }

    const active = this.active;
    if (!active || active.pointerId !== event.pointerId) {
      if (this.active && event.pointerType === 'touch') {
        event.preventDefault();
        event.stopPropagation();
      }
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const samples = event.getCoalescedEvents?.() ?? [];
    const batch = samples.length > 0 ? samples : [event];
    for (const sample of batch) this.appendPoint(active, sample);

    this.paintIncremental(active);
  };

  handlePointerUp = (event: PointerEvent): void => {
    if (event.pointerType === 'pen') this.router.notePenReleased(event.pointerId);

    const active = this.active;
    if (!active || active.pointerId !== event.pointerId) return;

    event.preventDefault();
    event.stopPropagation();

    this.appendPoint(active, event, { force: true });
    this.finishStroke(active);
  };

  handlePointerCancel = (event: PointerEvent): void => {
    if (event.pointerType === 'pen') this.router.notePenReleased(event.pointerId);
    if (this.active && this.active.pointerId === event.pointerId) this.abort();
  };

  /** Bricht einen laufenden Strich ab (z.B. beim Verlassen der Insel). */
  abort(): void {
    const active = this.active;
    if (!active) return;
    this.active = null;
    endInputGesture();

    if (active.stroke.tool === 'eraser') {
      // Wie in v1: live bereits auf die Kacheln gewirkt – ein Abbruch kann
      // das nicht zurueckholen, also den Strich doch uebernehmen, damit
      // Bild und Daten zusammenpassen.
      if (active.stroke.points.length > 0) {
        active.erasePainters?.closeAll();
        this.host.onStrokeCommitted(active.layerId, active.stroke);
      }
    } else {
      const wet = this.host.getWetContext();
      if (wet) clearContext(wet);
    }
    this.pressureProbe.endStroke();
  }

  // -------------------------------------------------------------------------

  private beginStroke(event: PointerEvent, tool: ToolKind): void {
    if (this.active) this.abort();

    const state = this.host.getDrawingState();
    if (!state.activeLayerId) return;

    const tileGrid = this.host.getTileGrid(state.activeLayerId);
    if (!tileGrid) return;

    const stroke = createStroke({
      color: state.color,
      width: tool === 'eraser' ? state.eraserWidth : state.penWidth,
      tool,
    });

    let wetPainter: StrokePainter | null = null;
    if (tool === 'pen') {
      const wetCtx = this.host.getWetContext();
      if (!wetCtx) return;
      wetPainter = new StrokePainter(wetCtx, stroke);
    }

    beginInputGesture();

    this.active = {
      stroke,
      layerId: state.activeLayerId,
      tileGrid,
      pointerId: event.pointerId,
      startedAt: event.timeStamp,
      smoothedPressure: null,
      wetPainter,
      erasePainters: tool === 'eraser' ? new TiledErasePainters() : null,
    };

    const element = this.host.getIslandElement();
    try {
      element?.setPointerCapture(event.pointerId);
    } catch {
      // Manche Browser werfen, wenn der Pointer schon weg ist – nicht schlimm.
    }

    this.appendPoint(this.active, event, { force: true });
    this.paintIncremental(this.active);
  }

  private finishStroke(active: ActiveStroke): void {
    this.active = null;
    endInputGesture();
    this.pressureProbe.endStroke();

    if (active.stroke.tool === 'pen') {
      active.wetPainter?.close();
      // Den fertigen Strich einmalig in alle betroffenen Kacheln malen –
      // siehe TileGrid.commitStroke fuer die Begruendung (Pixel-fuer-Pixel
      // identisch zu dem, was ein spaeterer Neuaufbau aus den Daten ergibt).
      active.tileGrid.commitStroke(active.stroke);
      const wet = this.host.getWetContext();
      if (wet) clearContext(wet);
    } else {
      // Radierer: die Kacheln sind durch den Live-Pfad bereits auf dem
      // aktuellen Stand, nur noch Painter sauber abschliessen.
      active.erasePainters?.closeAll();
    }

    this.host.onStrokeCommitted(active.layerId, active.stroke);
  }

  /** Zeichnet nach, was seit dem letzten Aufruf an neuen Punkten dazukam. */
  private paintIncremental(active: ActiveStroke): void {
    if (active.stroke.tool === 'pen') {
      active.wetPainter?.drawPending();
      return;
    }

    // Radiergummi: nur die Kacheln anfassen, die der JUENGST hinzugekommene
    // Teil des Strichs ueberhaupt beruehrt – nicht die ganze bisherige
    // Streckenlaenge neu pruefen. Ein Teilstueck braucht hoechstens die
    // letzten drei Punkte (siehe StrokePainter), etwas Rand per Strichbreite.
    const recentPoints = active.stroke.points.slice(-3);
    const incrementalBounds = boundsOf(recentPoints, active.stroke.width / 2 + 1);
    if (!incrementalBounds || !active.erasePainters) return;

    const targets = active.tileGrid.getMountedTilesOverlapping(incrementalBounds);
    for (const ctx of targets) {
      active.erasePainters.ensureFor(ctx, active.stroke).drawPending();
    }
  }

  private appendPoint(
    active: ActiveStroke,
    sample: PointerEvent,
    options: { force?: boolean } = {},
  ): void {
    const element = this.host.getIslandElement();
    if (!element) return;

    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    const { width: worldWidth, height: worldHeight } = this.host.getWorldSize();

    // Bildschirm- -> Insel-lokaler Raum. Ueber das Rect zu gehen macht die
    // Umrechnung automatisch unabhaengig von der kompletten Transform-Kette
    // (Insel-eigenes translate(x,y) UND der Pan/Zoom der Szene darueber) –
    // getBoundingClientRect() liefert immer die fertig aufgeloeste
    // Bildschirm-Position, egal wie viele CSS-Transforms dazwischen liegen.
    const x = ((sample.clientX - rect.left) / rect.width) * worldWidth;
    const y = ((sample.clientY - rect.top) / rect.height) * worldHeight;

    const points = active.stroke.points;
    const previous = points[points.length - 1];
    if (!options.force && previous && distance(previous, { x, y }) < MIN_POINT_DISTANCE) {
      return;
    }

    if (sample.pointerType === 'pen') this.pressureProbe.observe(sample.pressure);

    const normalized = this.pressureProbe.normalize(sample.pressure);
    const smoothed = smoothPressure(active.smoothedPressure, normalized);
    active.smoothedPressure = smoothed;

    const point: StrokePoint = {
      x: Math.round(x * 100) / 100,
      y: Math.round(y * 100) / 100,
      pressure: Math.round(clamp(smoothed, 0, 1) * 1000) / 1000,
      timestamp: Math.max(0, Math.round(sample.timeStamp - active.startedAt)),
    };

    points.push(point);
  }
}

/** Re-Export, damit Aufrufer nicht zusaetzlich aus ink/geometry importieren muessen. */
export type { Bounds };
