import { ERASER_WIDTHS, PEN_COLORS, PEN_WIDTHS } from '../config';
import type { SceneToolState } from './sceneToolState';

interface ToolbarProps {
  tool: SceneToolState;
  updateTool: (patch: Partial<SceneToolState>) => void;
  onAddIsland: () => void;
}

/**
 * Minimale Werkzeugleiste fuer Stage B – reicht, um die Zeichen-Pipeline zu
 * testen. Ebenen-Panel, Seiten/Inseln-Verwaltung etc. kommen mit Stage D/E.
 */
export function Toolbar({ tool, updateTool, onAddIsland }: ToolbarProps) {
  return (
    <header className="scene-toolbar">
      <div className="toolbar-group">
        {(['auto', 'pen', 'eraser'] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            className={tool.mode === mode ? 'active' : ''}
            onClick={() => updateTool({ mode })}
          >
            {mode === 'auto' ? 'Auto' : mode === 'pen' ? 'Stift' : 'Radierer'}
          </button>
        ))}
      </div>

      <div className="toolbar-group">
        {PEN_COLORS.map((color) => (
          <button
            key={color}
            type="button"
            className={`swatch${tool.color === color ? ' active' : ''}`}
            style={{ background: color }}
            onClick={() => updateTool({ color })}
            aria-label={`Farbe ${color}`}
          />
        ))}
      </div>

      <div className="toolbar-group">
        {PEN_WIDTHS.map((width) => (
          <button
            key={width}
            type="button"
            className={tool.penWidth === width ? 'active' : ''}
            onClick={() => updateTool({ penWidth: width })}
          >
            {width}
          </button>
        ))}
      </div>

      <div className="toolbar-group">
        {ERASER_WIDTHS.map((width) => (
          <button
            key={width}
            type="button"
            className={tool.eraserWidth === width ? 'active' : ''}
            onClick={() => updateTool({ eraserWidth: width })}
          >
            {width}
          </button>
        ))}
      </div>

      <div className="toolbar-group">
        <button type="button" onClick={onAddIsland}>
          + Insel
        </button>
      </div>
    </header>
  );
}
