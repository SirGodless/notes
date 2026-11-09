/**
 * Pan/Zoom der gesamten Szene (des Meeres). Eigene Implementierung statt
 * natives Scrollen – das Meer ist kein Scroll-Container mehr, sondern eine
 * CSS-Transform auf einem "Welt"-Div (translate(x,y) scale(zoom)).
 *
 * Reagiert absichtlich nur auf Pointer-Events, die BIS HIERHER durchgereicht
 * wurden: eine Insel, die gerade zeichnet, ruft in ihrem eigenen (Capture-
 * Phase-)Handler bereits stopPropagation() auf (siehe IslandInkController) –
 * dieser Controller sitzt in der normalen Bubble-Phase am aeusseren
 * Viewport-Container und sieht solche Events deshalb nie. Dadurch brauchen
 * wir hier keine eigene Palm-Rejection-Logik: "Finger scrollt, Stift
 * zeichnet" ergibt sich allein aus der Reihenfolge der Event-Phasen.
 */

import { MAX_ZOOM, MIN_ZOOM } from '../config';
import { clamp } from '../ink/geometry';

export interface SceneTransform {
  x: number;
  y: number;
  zoom: number;
}

export const IDENTITY_TRANSFORM: SceneTransform = { x: 0, y: 0, zoom: 1 };

interface DragState {
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startX: number;
  startY: number;
}

export class PanZoomController {
  private transform: SceneTransform = IDENTITY_TRANSFORM;
  private drag: DragState | null = null;

  constructor(private readonly onChange: (transform: SceneTransform) => void) {}

  getTransform(): SceneTransform {
    return this.transform;
  }

  setTransform(transform: SceneTransform): void {
    this.transform = transform;
    this.onChange(this.transform);
  }

  get isDragging(): boolean {
    return this.drag !== null;
  }

  handlePointerDown = (event: PointerEvent): void => {
    if (this.drag) return;
    this.drag = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: this.transform.x,
      startY: this.transform.y,
    };
  };

  handlePointerMove = (event: PointerEvent): void => {
    const drag = this.drag;
    if (!drag || drag.pointerId !== event.pointerId) return;

    this.transform = {
      ...this.transform,
      x: drag.startX + (event.clientX - drag.startClientX),
      y: drag.startY + (event.clientY - drag.startClientY),
    };
    this.onChange(this.transform);
  };

  handlePointerUp = (event: PointerEvent): void => {
    if (this.drag?.pointerId === event.pointerId) this.drag = null;
  };

  handlePointerCancel = (event: PointerEvent): void => {
    if (this.drag?.pointerId === event.pointerId) this.drag = null;
  };

  /**
   * Zoom um die Cursor-/Finger-Position herum: der Weltpunkt unter dem
   * Cursor bleibt waehrend des Zoomens an derselben Bildschirmposition.
   * `anchorX/Y` sind Viewport-lokale Koordinaten (clientX/Y minus das Rect
   * des Viewport-Containers).
   */
  zoomAt(anchorX: number, anchorY: number, factor: number): void {
    const nextZoom = clamp(this.transform.zoom * factor, MIN_ZOOM, MAX_ZOOM);
    if (nextZoom === this.transform.zoom) return;

    const worldX = (anchorX - this.transform.x) / this.transform.zoom;
    const worldY = (anchorY - this.transform.y) / this.transform.zoom;

    this.transform = {
      zoom: nextZoom,
      x: anchorX - worldX * nextZoom,
      y: anchorY - worldY * nextZoom,
    };
    this.onChange(this.transform);
  }
}
