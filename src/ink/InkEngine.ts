import { MIN_POINT_DISTANCE, PAGE_HEIGHT, PAGE_WIDTH } from '../config';
import { createStroke } from '../model/factory';
import type { Stroke, StrokePoint, ToolKind } from '../model/types';
import { clamp, distance } from './geometry';
import { beginInputGesture, endInputGesture } from './inputActivity';
import { PressureProbe, smoothPressure } from './pressure';
import type { PointerRouter, ToolMode } from './pointerRouter';
import { clearContext, renderStroke, StrokePainter } from './renderer';

/**
 * Was die Engine von aussen braucht. Die React-Komponente implementiert das –
 * dadurch bleibt die Engine selbst frei von React.
 */
export interface InkHost {
  /** Das Element, dessen Rect den Page-Space aufspannt (die Seite selbst). */
  getPageElement(): HTMLElement | null;
  /** Context des Zwischen-Canvas, auf dem der laufende Strich entsteht. */
  getWetContext(): CanvasRenderingContext2D | null;
  /** Context des Canvas einer Ebene. */
  getLayerContext(layerId: string): CanvasRenderingContext2D | null;
  /** Aktueller Zeichenzustand aus der Toolbar bzw. dem Ebenen-Panel. */
  getDrawingState(): {
    activeLayerId: string | null;
    toolMode: ToolMode;
    color: string;
    penWidth: number;
    eraserWidth: number;
  };
  /** Wird nach dem Abheben mit dem fertigen Strich gerufen. */
  onStrokeCommitted(layerId: string, stroke: Stroke): void;
}

interface ActiveStroke {
  stroke: Stroke;
  layerId: string;
  painter: StrokePainter;
  /** Ziel-Context: beim Stift das Wet-Canvas, beim Radierer direkt die Ebene. */
  ctx: CanvasRenderingContext2D;
  pointerId: number;
  startedAt: number;
  smoothedPressure: number | null;
}

/**
 * Die Zeichen-Engine einer einzelnen Seite.
 *
 * Performance-Grundsatz: waehrend eines Strichs passiert *kein* React-Render.
 * Pointer-Events schreiben direkt ins Canvas, React erfaehrt erst beim
 * Abheben davon. Ein setState pro Punkt waere bei der Abtastrate eines
 * aktiven Stifts (S-Pen liefert deutlich mehr als 60 Samples/s) der sichere
 * Weg in einstellige Bildraten.
 *
 * Zweiter Grundsatz: pro neuem Punkt wird genau ein Teilstueck gezeichnet,
 * nie der ganze Strich neu. Dadurch ist der Aufwand pro Frame konstant,
 * egal wie lang der Strich schon ist.
 *
 * Gezeichnet wird synchron im pointermove-Handler statt in einem
 * requestAnimationFrame-Puffer. Chrome und Firefox liefern pointermove
 * ohnehin an die Bildwiederholung gekoppelt aus; ein zusaetzlicher rAF-Umweg
 * wuerde nur bis zu einem Frame Latenz draufrechnen, und Latenz ist beim
 * Schreiben das, was man am staerksten spuert.
 */
export class InkEngine {
  private readonly pressureProbe = new PressureProbe();
  private active: ActiveStroke | null = null;

  /**
   * Der Router wird von aussen hereingereicht und von allen Seiten geteilt.
   * Palm Rejection muss dokumentweit gelten: der Handballen liegt beim
   * Schreiben am oberen Seitenrand gerne auf der Seite darunter.
   */
  constructor(
    private readonly host: InkHost,
    private readonly router: PointerRouter,
  ) {}

  dispose(): void {
    this.abort();
  }

  get isDrawing(): boolean {
    return this.active !== null;
  }

  // -------------------------------------------------------------------------
  // Pointer-Handler. Werden als native Listener in der Capture-Phase
  // registriert, damit sie vor dem contenteditable des Text-Layers drankommen.
  // -------------------------------------------------------------------------

  handlePointerDown = (event: PointerEvent): void => {
    if (event.pointerType === 'pen') this.router.notePenActivity(event.pointerId, true);

    const { toolMode } = this.host.getDrawingState();
    const verdict = this.router.decide(event, toolMode);

    if (verdict.action === 'passthrough') return;

    // Ab hier gehoert das Event uns: kein Scrollen, kein Textcursor, keine
    // Textauswahl.
    event.preventDefault();
    event.stopPropagation();

    if (verdict.action === 'swallow') return;

    this.beginStroke(event, verdict.tool);
  };

  handlePointerMove = (event: PointerEvent): void => {
    if (event.pointerType === 'pen') {
      // Auch Schweben melden – der Stift kuendigt sich dadurch an, bevor er
      // aufsetzt, und die Seite kann rechtzeitig auf touch-action: none gehen.
      this.router.notePenActivity(event.pointerId, this.active !== null);
    }

    const active = this.active;
    if (!active || active.pointerId !== event.pointerId) {
      // Handballen waehrend eines laufenden Strichs: schlucken, sonst scrollt
      // die Seite unter dem Stift weg.
      if (this.active && event.pointerType === 'touch') {
        event.preventDefault();
        event.stopPropagation();
      }
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    // getCoalescedEvents liefert die Zwischenpositionen, die der Browser zu
    // einem einzigen pointermove zusammengefasst hat. Ohne das verliert man
    // bei schnellen Bewegungen Stuetzpunkte und die Linie wird eckig.
    const samples = event.getCoalescedEvents?.() ?? [];
    const batch = samples.length > 0 ? samples : [event];

    for (const sample of batch) {
      this.appendPoint(active, sample);
    }
    active.painter.drawPending();
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

  /** Bricht einen laufenden Strich ersatzlos ab (z.B. beim Verlassen der Seite). */
  abort(): void {
    const active = this.active;
    if (!active) return;
    this.active = null;
    endInputGesture();

    if (active.stroke.tool === 'eraser') {
      // Der Radierer hat live auf der Ebene gearbeitet. Ein Abbruch kann das
      // nicht zurueckholen – also lieber den Strich doch uebernehmen, damit
      // Bild und Daten zusammenpassen.
      if (active.stroke.points.length > 0) {
        active.painter.close();
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

    const layerCtx = this.host.getLayerContext(state.activeLayerId);
    if (!layerCtx) return;

    // Stift zeichnet auf ein eigenes Zwischen-Canvas, damit ein Undo waehrend
    // des Strichs nichts kaputt macht und der Strich beim Abheben in einem
    // Rutsch uebernommen werden kann.
    //
    // Der Radierer dagegen muss direkt auf der Ebene arbeiten: destination-out
    // auf einem leeren Zwischen-Canvas wuerde nichts bewirken. Genau das macht
    // das Radieren pixelgenau statt strichweise.
    const ctx = tool === 'eraser' ? layerCtx : this.host.getWetContext();
    if (!ctx) return;

    const stroke = createStroke({
      color: state.color,
      width: tool === 'eraser' ? state.eraserWidth : state.penWidth,
      tool,
    });

    beginInputGesture();

    this.active = {
      stroke,
      layerId: state.activeLayerId,
      painter: new StrokePainter(ctx, stroke),
      ctx,
      pointerId: event.pointerId,
      startedAt: event.timeStamp,
      smoothedPressure: null,
    };

    const element = this.host.getPageElement();
    try {
      element?.setPointerCapture(event.pointerId);
    } catch {
      // Manche Browser werfen, wenn der Pointer schon weg ist – nicht schlimm.
    }

    this.appendPoint(this.active, event, { force: true });
    this.active.painter.drawPending();
  }

  private finishStroke(active: ActiveStroke): void {
    this.active = null;
    endInputGesture();
    active.painter.close();
    this.pressureProbe.endStroke();

    if (active.stroke.tool === 'pen') {
      // Den fertigen Strich noch einmal direkt auf die Ebene zeichnen statt
      // das Wet-Canvas darueberzukopieren. Das kostet einmalig ein paar
      // Millisekunden, garantiert aber, dass das Ergebnis Pixel fuer Pixel
      // dem entspricht, was beim naechsten Laden aus den Daten entsteht –
      // ein kopiertes Canvas wuerde die Kantenglaettung ein zweites Mal
      // ueberblenden und minimal anders aussehen.
      const layerCtx = this.host.getLayerContext(active.layerId);
      if (layerCtx) renderStroke(layerCtx, active.stroke);

      const wet = this.host.getWetContext();
      if (wet) clearContext(wet);
    }

    this.host.onStrokeCommitted(active.layerId, active.stroke);
  }

  private appendPoint(
    active: ActiveStroke,
    sample: PointerEvent,
    options: { force?: boolean } = {},
  ): void {
    const element = this.host.getPageElement();
    if (!element) return;

    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    // Bildschirm- -> Page-Space. Ueber das Rect zu gehen macht die Umrechnung
    // automatisch zoom-unabhaengig: egal wie gross die Seite gerade dargestellt
    // wird, gespeichert werden immer A4-Koordinaten.
    const x = ((sample.clientX - rect.left) / rect.width) * PAGE_WIDTH;
    const y = ((sample.clientY - rect.top) / rect.height) * PAGE_HEIGHT;

    const points = active.stroke.points;
    const previous = points[points.length - 1];

    if (!options.force && previous && distance(previous, { x, y }) < MIN_POINT_DISTANCE) {
      return;
    }

    if (sample.pointerType === 'pen') {
      this.pressureProbe.observe(sample.pressure);
    }

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
