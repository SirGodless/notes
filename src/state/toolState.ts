import { DEFAULT_ERASER_WIDTH, DEFAULT_PEN_WIDTH, PEN_COLORS } from '../config';
import type { ToolMode } from '../ink/pointerRouter';

export interface ToolState {
  /**
   * 'auto' = der Eingabetyp entscheidet (Stift zeichnet, Finger scrollt,
   * Maus setzt den Textcursor). 'pen'/'eraser' erzwingen das Werkzeug auch
   * fuer Maus und Finger.
   */
  mode: ToolMode;
  color: string;
  penWidth: number;
  eraserWidth: number;
  zoom: number;
}

export const initialToolState: ToolState = {
  mode: 'auto',
  color: PEN_COLORS[0],
  penWidth: DEFAULT_PEN_WIDTH,
  eraserWidth: DEFAULT_ERASER_WIDTH,
  zoom: 1,
};
