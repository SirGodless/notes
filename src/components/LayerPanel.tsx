import { useState } from 'react';
import { SOFT_LAYER_LIMIT } from '../config';
import { findPage } from '../state/documentReducer';
import { useApp } from '../state/AppState';

/**
 * Ebenen-Verwaltung fuer die zuletzt benutzte Seite.
 *
 * Die Liste wird von oben nach unten angezeigt, also oberste Ebene zuerst –
 * so wie man einen Stapel von der Seite aus sieht.
 */
export function LayerPanel() {
  const { doc, dispatch, focusedPageId, activeLayerId, setActiveLayer, addLayer, addPage, deletePage } =
    useApp();
  const [renamingId, setRenamingId] = useState<string | null>(null);

  const page = findPage(doc, focusedPageId);
  if (!page) return null;

  const pageIndex = doc.pages.findIndex((candidate) => candidate.id === page.id);
  const activeId = activeLayerId(page);
  const layersTopFirst = [...page.layers].sort((a, b) => b.order - a.order);

  return (
    <aside className="layer-panel">
      <div className="panel-section">
        <h2>Seite {pageIndex + 1}</h2>
        <div className="panel-row">
          <button type="button" onClick={() => addPage(page.id)}>
            Seite einfügen
          </button>
          <button
            type="button"
            disabled={doc.pages.length <= 1}
            onClick={() => {
              if (window.confirm('Diese Seite mit allen Ebenen löschen?')) deletePage(page.id);
            }}
          >
            Seite löschen
          </button>
        </div>
      </div>

      <div className="panel-section">
        <h2>Ebenen</h2>
        <ul className="layer-list">
          {layersTopFirst.map((layer) => {
            const isActive = layer.id === activeId;
            return (
              <li key={layer.id} className={`layer-item${isActive ? ' active' : ''}`}>
                <button
                  type="button"
                  className="layer-visibility"
                  title={layer.visible ? 'Ausblenden' : 'Einblenden'}
                  onClick={() =>
                    dispatch({
                      type: 'set-layer-visible',
                      pageId: page.id,
                      layerId: layer.id,
                      visible: !layer.visible,
                    })
                  }
                >
                  {layer.visible ? '👁' : '🚫'}
                </button>

                {renamingId === layer.id ? (
                  <input
                    className="layer-name-input"
                    autoFocus
                    defaultValue={layer.name}
                    onBlur={(event) => {
                      dispatch({
                        type: 'rename-layer',
                        pageId: page.id,
                        layerId: layer.id,
                        name: event.target.value.trim() || layer.name,
                      });
                      setRenamingId(null);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') event.currentTarget.blur();
                      if (event.key === 'Escape') setRenamingId(null);
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    className="layer-name"
                    onClick={() => setActiveLayer(page.id, layer.id)}
                    onDoubleClick={() => setRenamingId(layer.id)}
                    title="Klicken zum Aktivieren, Doppelklick zum Umbenennen"
                  >
                    {layer.name}
                    {!layer.visible && <span className="layer-hint"> (aus)</span>}
                  </button>
                )}

                <div className="layer-actions">
                  <button
                    type="button"
                    title="Nach oben"
                    disabled={layer.order === page.layers.length - 1}
                    onClick={() =>
                      dispatch({ type: 'move-layer', pageId: page.id, layerId: layer.id, direction: 1 })
                    }
                  >
                    ▲
                  </button>
                  <button
                    type="button"
                    title="Nach unten"
                    disabled={layer.order === 0}
                    onClick={() =>
                      dispatch({ type: 'move-layer', pageId: page.id, layerId: layer.id, direction: -1 })
                    }
                  >
                    ▼
                  </button>
                  <button
                    type="button"
                    title="Ebene löschen"
                    disabled={page.layers.length <= 1}
                    onClick={() => {
                      if (window.confirm(`Ebene "${layer.name}" mit allen Strichen löschen?`)) {
                        dispatch({ type: 'delete-layer', pageId: page.id, layerId: layer.id });
                      }
                    }}
                  >
                    ✕
                  </button>
                </div>
              </li>
            );
          })}
        </ul>

        <button type="button" className="add-layer" onClick={() => addLayer(page.id)}>
          + Ebene
        </button>

        {page.layers.length >= SOFT_LAYER_LIMIT && (
          <p className="panel-warning">
            Viele Ebenen kosten Speicher – jede belegt pro Seite rund 14 MB.
          </p>
        )}
      </div>

      <div className="panel-section panel-help">
        <h2>Bedienung</h2>
        <ul>
          <li>Stift zeichnet auf der aktiven Ebene, ganz ohne Modus-Umschalten.</li>
          <li>Finger scrollt. Während der Stift arbeitet, wird er ignoriert.</li>
          <li>Stift-Seitentaste radiert.</li>
          <li>Tippen geht immer in den Text – unabhängig von der Ebene.</li>
          <li>Strg+Z macht das zuletzt Getane rückgängig, Text wie Tinte.</li>
        </ul>
      </div>
    </aside>
  );
}
