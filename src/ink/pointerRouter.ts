import {
  BARREL_BUTTON_ERASES,
  BARREL_BUTTON_MASK,
  ERASER_BUTTON_MASK,
  PEN_IDLE_GRACE_MS,
  STICKY_PEN_MODE,
} from '../config';
import type { ToolKind } from '../model/types';

/**
 * Was mit einem Pointer-Event passieren soll.
 *
 * - `draw`        : Wir zeichnen. Das Event wird geschluckt (preventDefault).
 * - `swallow`     : Nichts tun, Event aber trotzdem schlucken. Das ist der
 *                   Handballen: er darf weder zeichnen noch scrollen noch den
 *                   Textcursor versetzen.
 * - `passthrough` : Browser und Text-Layer machen ihr normales Ding – also
 *                   scrollen bzw. Cursor setzen.
 */
export type PointerAction = 'draw' | 'swallow' | 'passthrough';

export interface PointerVerdict {
  action: PointerAction;
  tool: ToolKind;
}

/** Manuelle Werkzeug-Vorwahl aus der Toolbar. */
export type ToolMode = 'auto' | 'pen' | 'eraser';

export interface PointerRouterOptions {
  /** Wird gerufen, wenn sich der "Stift ist gerade aktiv"-Zustand aendert. */
  onPenActiveChange?: (penActive: boolean) => void;
}

/**
 * Entscheidet fuer jedes Pointer-Event, ob gezeichnet, ignoriert oder
 * durchgereicht wird. Bewusst ohne React und ohne DOM – dadurch ist die
 * Palm-Rejection-Logik fuer sich betrachtbar und testbar.
 *
 * Die drei Stufen der Palm Rejection:
 *
 *  1. Solange ein Stift-Pointer unten ist, wird jede Finger-Eingabe verworfen.
 *  2. Danach noch PEN_IDLE_GRACE_MS lang – das deckt die kurzen Absetzer
 *     zwischen Buchstaben ab, bei denen der Ballen liegen bleibt.
 *  3. Wurde auf diesem Geraet ueberhaupt je ein Stift benutzt, zeichnet der
 *     Finger nie mehr, sondern scrollt nur. Das ist die Stufe, die den Fall
 *     abdeckt, den 1. und 2. prinzipiell nicht koennen: der Ballen liegt
 *     meistens schon auf dem Display, *bevor* die Stiftspitze ueberhaupt
 *     registriert wird.
 */
export class PointerRouter {
  private lastPenActivityAt = 0;
  private activePenPointerId: number | null = null;
  private penEverSeen = false;
  private penActiveFlag = false;
  private graceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly options: PointerRouterOptions = {}) {}

  get penActive(): boolean {
    return this.penActiveFlag;
  }

  get penEverUsed(): boolean {
    return this.penEverSeen;
  }

  /**
   * Auch Hover-Bewegungen des Stifts melden (pointermove ohne gedrueckte
   * Spitze). Der S-Pen schwebt, bevor er aufsetzt – dadurch steht
   * `touch-action: none` schon eine Frame frueher, und die erste Stiftbewegung
   * scrollt nicht versehentlich die Seite.
   */
  notePenActivity(pointerId: number | null, isDown: boolean): void {
    this.lastPenActivityAt = performance.now();
    this.penEverSeen = true;
    if (isDown) this.activePenPointerId = pointerId;
    this.setPenActive(true);
    this.scheduleGraceExpiry();
  }

  notePenReleased(pointerId: number): void {
    if (this.activePenPointerId === pointerId) this.activePenPointerId = null;
    this.lastPenActivityAt = performance.now();
    this.scheduleGraceExpiry();
  }

  /** Aufraeumen beim Unmount, damit kein Timer weiterlaeuft. */
  dispose(): void {
    if (this.graceTimer !== null) clearTimeout(this.graceTimer);
    this.graceTimer = null;
  }

  decide(event: PointerEvent, mode: ToolMode): PointerVerdict {
    switch (event.pointerType) {
      case 'pen':
        return { action: 'draw', tool: this.penTool(event, mode) };

      case 'touch':
        if (this.isInPenLockout()) return { action: 'swallow', tool: 'pen' };
        // Auf einem Geraet ohne Stift soll man mit dem Finger malen koennen,
        // wenn man das Werkzeug bewusst ausgewaehlt hat. Sobald hier aber je
        // ein Stift benutzt wurde, bleibt der Finger reines Scroll-Werkzeug –
        // sonst zeichnet frueher oder spaeter der Handballen mit.
        if ((mode === 'pen' || mode === 'eraser') && !(STICKY_PEN_MODE && this.penEverSeen)) {
          return { action: 'draw', tool: mode };
        }
        return { action: 'passthrough', tool: 'pen' };

      default:
        // Maus und alles Unbekannte: nur zeichnen, wenn das Werkzeug
        // ausdruecklich von Hand gewaehlt wurde. Sonst waere Textauswahl
        // mit der Maus unmoeglich.
        if (mode === 'pen' || mode === 'eraser') {
          return { action: 'draw', tool: mode };
        }
        return { action: 'passthrough', tool: 'pen' };
    }
  }

  private penTool(event: PointerEvent, mode: ToolMode): ToolKind {
    if (mode !== 'auto') return mode;

    const buttons = event.buttons;
    if ((buttons & ERASER_BUTTON_MASK) !== 0) return 'eraser';
    if (BARREL_BUTTON_ERASES && (buttons & BARREL_BUTTON_MASK) !== 0) return 'eraser';
    return 'pen';
  }

  /**
   * Stufe 1 und 2. Stufe 3 (penEverSeen) taucht hier absichtlich nicht auf:
   * sie besagt nur "der Finger zeichnet nie", und das ist in dieser Version
   * ohnehin der Fall – `decide` gibt fuer 'touch' nie 'draw' zurueck. Waere
   * Finger-Zeichnen spaeter optional, greift STICKY_PEN_MODE genau dort.
   */
  private isInPenLockout(): boolean {
    if (this.activePenPointerId !== null) return true;
    return performance.now() - this.lastPenActivityAt < PEN_IDLE_GRACE_MS;
  }

  private scheduleGraceExpiry(): void {
    if (this.graceTimer !== null) clearTimeout(this.graceTimer);
    this.graceTimer = setTimeout(() => {
      this.graceTimer = null;
      if (this.activePenPointerId === null) this.setPenActive(false);
    }, PEN_IDLE_GRACE_MS + 20);
  }

  private setPenActive(next: boolean): void {
    if (this.penActiveFlag === next) return;
    this.penActiveFlag = next;
    this.options.onPenActiveChange?.(next);
  }
}
