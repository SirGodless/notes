/**
 * Werkzeug-Einstellungen fuer die v2-Szene. Bewusst NICHT v1s ToolState
 * (laengst entfernt, siehe Stage F/Cutover) wiederverwendet: der hatte ein
 * `zoom`-Feld, das dort die Seiten-Darstellung skalierte – in der Szene
 * uebernimmt das PanZoomController.getTransform().zoom, ein zweites,
 * gleichnamiges aber anders gemeintes Feld haette nur verwirrt.
 */

import { DEFAULT_ERASER_WIDTH, DEFAULT_PEN_WIDTH, PEN_COLORS } from '../config';
import type { ToolMode } from '../ink/pointerRouter';

export interface SceneToolState {
  mode: ToolMode;
  color: string;
  penWidth: number;
  eraserWidth: number;
}

export const initialSceneToolState: SceneToolState = {
  mode: 'auto',
  color: PEN_COLORS[0],
  penWidth: DEFAULT_PEN_WIDTH,
  eraserWidth: DEFAULT_ERASER_WIDTH,
};
