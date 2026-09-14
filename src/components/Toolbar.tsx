import { useRef } from 'react';
import {
  ERASER_WIDTHS,
  MAX_ZOOM,
  MIN_ZOOM,
  PEN_COLORS,
  PEN_WIDTHS,
  ZOOM_STEP,
} from '../config';
import { useApp } from '../state/AppState';
import type { SaveState } from '../storage/autosave';

const SAVE_LABEL: Record<SaveState, string> = {
  idle: 'bereit',
  pending: 'ungespeicherte Änderungen',
  saving: 'speichert …',
  saved: 'gespeichert',
  error: 'Speichern fehlgeschlagen',
};

export function Toolbar() {
  const {
    tool,
    updateTool,
    undo,
    redo,
    saveState,
    doc,
    setTitle,
    newDocument,
    openFile,
    saveToFile,
  } = useApp();

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const clampZoom = (next: number) =>
    Math.round(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next)) * 100) / 100;

  return (
    <header className="toolbar">
      <div className="toolbar-group toolbar-title">
        <input
          className="title-input"
          value={doc.title}
          onChange={(event) => setTitle(event.target.value)}
          aria-label="Titel der Notiz"
        />
        <span className={`save-state save-state-${saveState}`}>{SAVE_LABEL[saveState]}</span>
      </div>

      <div className="toolbar-group">
        <span className="group-label">Werkzeug</span>
        {(
          [
            ['auto', 'Auto', 'Stift zeichnet, Finger scrollt, Maus schreibt Text'],
            ['pen', 'Stift', 'Auch Maus und Finger zeichnen'],
            ['eraser', 'Radierer', 'Radiert pixelgenau'],
          ] as const
        ).map(([mode, label, hint]) => (
          <button
            key={mode}
            type="button"
            title={hint}
            className={tool.mode === mode ? 'active' : ''}
            onClick={() => updateTool({ mode })}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="toolbar-group">
        <span className="group-label">Farbe</span>
        <div className="swatches">
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
          <input
            type="color"
            className="swatch swatch-custom"
            value={tool.color}
            onChange={(event) => updateTool({ color: event.target.value })}
            aria-label="Eigene Farbe"
          />
        </div>
      </div>

      <div className="toolbar-group">
        <span className="group-label">Strich</span>
        {PEN_WIDTHS.map((width) => (
          <button
            key={width}
            type="button"
            className={`width-button${tool.penWidth === width ? ' active' : ''}`}
            onClick={() => updateTool({ penWidth: width })}
          >
            <span className="width-dot" style={{ width, height: width }} />
          </button>
        ))}
      </div>

      <div className="toolbar-group">
        <span className="group-label">Radierer</span>
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
        <button type="button" onClick={undo} title="Rückgängig (Strg+Z)">
          ↶
        </button>
        <button type="button" onClick={redo} title="Wiederholen (Strg+Umschalt+Z)">
          ↷
        </button>
      </div>

      <div className="toolbar-group">
        <span className="group-label">Zoom</span>
        <button type="button" onClick={() => updateTool({ zoom: clampZoom(tool.zoom - ZOOM_STEP) })}>
          −
        </button>
        <span className="zoom-value">{Math.round(tool.zoom * 100)}%</span>
        <button type="button" onClick={() => updateTool({ zoom: clampZoom(tool.zoom + ZOOM_STEP) })}>
          +
        </button>
        <button type="button" onClick={() => updateTool({ zoom: 1 })}>
          100%
        </button>
      </div>

      <div className="toolbar-group toolbar-files">
        <button type="button" onClick={newDocument}>
          Neu
        </button>
        <button type="button" onClick={() => fileInputRef.current?.click()}>
          Öffnen …
        </button>
        <button type="button" onClick={saveToFile} title="Als .json herunterladen (Strg+S)">
          Exportieren
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={async (event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (!file) return;
            try {
              await openFile(file);
            } catch (error) {
              window.alert(error instanceof Error ? error.message : 'Datei konnte nicht gelesen werden.');
            }
          }}
        />
      </div>
    </header>
  );
}
