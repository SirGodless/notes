import { PAGE_HEIGHT, PAGE_WIDTH } from '../config';
import type { InkLayer, Stroke, StrokePoint } from '../model/types';
import { midpoint } from './geometry';
import { widthAt } from './pressure';

/**
 * Zeichenlogik fuer Striche.
 *
 * Wichtigste Eigenschaft: Live-Zeichnen und Nachzeichnen aus gespeicherten
 * Daten laufen durch denselben Code (StrokePainter). Dadurch sieht ein
 * neu geladenes Dokument garantiert genauso aus wie im Moment des Zeichnens.
 *
 * Alle Funktionen hier arbeiten in Page-Space-Koordinaten. Die Umrechnung auf
 * die interne Canvas-Aufloesung passiert einmalig ueber die Transform-Matrix
 * des Contexts (prepareContext).
 */

/**
 * Setzt Groesse und Transform eines Layer-Canvas.
 * Gibt den Context zurueck, oder null wenn der Browser keinen liefert.
 */
export function prepareCanvas(
  canvas: HTMLCanvasElement,
  scale: number,
): CanvasRenderingContext2D | null {
  const targetWidth = Math.round(PAGE_WIDTH * scale);
  const targetHeight = Math.round(PAGE_HEIGHT * scale);

  // Groesse nur setzen wenn noetig – ein Schreibzugriff auf canvas.width
  // leert das Canvas, auch wenn sich der Wert nicht aendert.
  if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
    canvas.width = targetWidth;
    canvas.height = targetHeight;
  }

  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  return ctx;
}

export function clearContext(ctx: CanvasRenderingContext2D): void {
  ctx.globalCompositeOperation = 'source-over';
  ctx.clearRect(0, 0, PAGE_WIDTH, PAGE_HEIGHT);
}

function applyStrokeStyle(ctx: CanvasRenderingContext2D, stroke: Stroke): void {
  if (stroke.tool === 'eraser') {
    // Der Kern des pixelgenauen Radierens: destination-out entfernt genau die
    // Pixel, die der Radierer ueberstreicht – unabhaengig davon, zu welchem
    // Strich sie gehoerten.
    ctx.globalCompositeOperation = 'destination-out';
    ctx.strokeStyle = '#000';
    ctx.fillStyle = '#000';
  } else {
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = stroke.color;
    ctx.fillStyle = stroke.color;
  }
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
}

/**
 * Zeichnet einen Strich stueckweise.
 *
 * Der Pfad durch die Punkte p[0..n-1] ist:
 *
 *   p[0] --- Linie ---> M(0) --- Quadratisch ueber p[1] ---> M(1) --- ... ---> p[n-1]
 *
 * mit M(i) = Mittelpunkt zwischen p[i] und p[i+1]. Die Stuetzpunkte selbst
 * sind die Kontrollpunkte – das ist die klassische quadratische Interpolation
 * und ergibt sichtbar rundere Linien als ein Polygonzug.
 *
 * Aufgeteilt in "Teilstuecke":
 *   Stueck 0     : Linie  p[0] -> M(0)                     (braucht p[0], p[1])
 *   Stueck k>0   : Kurve  M(k-1) -> M(k), Kontrolle p[k]   (braucht p[k-1..k+1])
 *   Schlussstueck: Linie  M(n-2) -> p[n-1]                 (erst beim Abheben)
 *
 * Ein Teilstueck ist also zeichenbar, sobald der uebernaechste Punkt da ist.
 * Deshalb kostet ein neuer Punkt beim Live-Zeichnen genau einen Pfad – nicht
 * ein Neuzeichnen des ganzen Strichs. Das ist der Grund, warum auch ein sehr
 * langer Strich nicht langsamer wird.
 */
export class StrokePainter {
  private piecesDrawn = 0;
  private closed = false;

  constructor(
    private readonly ctx: CanvasRenderingContext2D,
    private readonly stroke: Stroke,
  ) {}

  /** Zeichnet alle Teilstuecke, die durch neu hinzugekommene Punkte vollstaendig sind. */
  drawPending(): void {
    if (this.closed) return;

    const points = this.stroke.points;
    const available = points.length - 1; // Stuecke 0 .. n-2
    if (available <= this.piecesDrawn) return;

    applyStrokeStyle(this.ctx, this.stroke);

    for (let k = this.piecesDrawn; k < available; k++) {
      this.drawPiece(k);
    }
    this.piecesDrawn = available;
  }

  /** Schliesst den Strich ab: Schlusskappe bzw. Punkt bei einem einzelnen Tipper. */
  close(): void {
    if (this.closed) return;
    this.drawPending();

    const points = this.stroke.points;
    applyStrokeStyle(this.ctx, this.stroke);

    if (points.length === 1) {
      this.drawDot(points[0]);
    } else if (points.length >= 2) {
      const last = points[points.length - 1];
      const beforeLast = points[points.length - 2];
      this.segment(midpoint(beforeLast, last), null, last, widthAt(last, this.stroke.width));
    }

    this.closed = true;
  }

  private drawPiece(k: number): void {
    const points = this.stroke.points;

    if (k === 0) {
      const start = points[0];
      this.segment(start, null, midpoint(start, points[1]), widthAt(start, this.stroke.width));
      return;
    }

    const control = points[k];
    this.segment(
      midpoint(points[k - 1], control),
      control,
      midpoint(control, points[k + 1]),
      widthAt(control, this.stroke.width),
    );
  }

  /** Ein Teilstueck als eigener Pfad – nur so kann jedes seine eigene Breite haben. */
  private segment(from: StrokePoint | { x: number; y: number }, control: StrokePoint | null, to: { x: number; y: number }, width: number): void {
    const ctx = this.ctx;
    ctx.lineWidth = Math.max(0.1, width);
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    if (control) {
      ctx.quadraticCurveTo(control.x, control.y, to.x, to.y);
    } else {
      ctx.lineTo(to.x, to.y);
    }
    ctx.stroke();
  }

  private drawDot(point: StrokePoint): void {
    const radius = widthAt(point, this.stroke.width) / 2;
    this.ctx.beginPath();
    this.ctx.arc(point.x, point.y, Math.max(0.1, radius), 0, Math.PI * 2);
    this.ctx.fill();
  }
}

/** Zeichnet einen fertigen Strich komplett. */
export function renderStroke(ctx: CanvasRenderingContext2D, stroke: Stroke): void {
  const painter = new StrokePainter(ctx, stroke);
  painter.close();
}

/**
 * Baut eine Ebene komplett aus ihrer Strich-Liste neu auf.
 *
 * Die Reihenfolge ist entscheidend: Radierer-Striche wirken nur auf das, was
 * vor ihnen gezeichnet wurde. Genau deshalb ist das Ergebnis reproduzierbar,
 * ohne dass Bitmaps gespeichert werden muessen.
 */
export function renderLayer(ctx: CanvasRenderingContext2D, layer: InkLayer): void {
  clearContext(ctx);
  for (const stroke of layer.strokes) {
    renderStroke(ctx, stroke);
  }
  ctx.globalCompositeOperation = 'source-over';
}
