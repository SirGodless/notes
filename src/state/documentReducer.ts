import type { InkLayer, NotesDocument, Page, Stroke, TextDoc } from '../model/types';

export type DocumentAction =
  | { type: 'load'; doc: NotesDocument }
  | { type: 'set-title'; title: string }
  | { type: 'set-page-text'; pageId: string; text: TextDoc }
  | { type: 'insert-stroke'; pageId: string; layerId: string; stroke: Stroke; index?: number }
  | { type: 'remove-stroke'; pageId: string; layerId: string; strokeId: string }
  | { type: 'add-layer'; pageId: string; layer: InkLayer }
  | { type: 'delete-layer'; pageId: string; layerId: string }
  | { type: 'rename-layer'; pageId: string; layerId: string; name: string }
  | { type: 'set-layer-visible'; pageId: string; layerId: string; visible: boolean }
  | { type: 'move-layer'; pageId: string; layerId: string; direction: -1 | 1 }
  | { type: 'insert-page'; page: Page; afterPageId: string | null }
  | { type: 'delete-page'; pageId: string };

export function documentReducer(state: NotesDocument, action: DocumentAction): NotesDocument {
  switch (action.type) {
    case 'load':
      return action.doc;

    case 'set-title':
      return touch({ ...state, title: action.title });

    case 'set-page-text':
      return touch(
        mapPage(state, action.pageId, (page) => ({ ...page, text: action.text })),
      );

    case 'insert-stroke':
      return touch(
        mapLayer(state, action.pageId, action.layerId, (layer) => {
          const strokes = [...layer.strokes];
          const index = action.index ?? strokes.length;
          strokes.splice(Math.min(Math.max(index, 0), strokes.length), 0, action.stroke);
          return { ...layer, strokes };
        }),
      );

    case 'remove-stroke':
      return touch(
        mapLayer(state, action.pageId, action.layerId, (layer) => ({
          ...layer,
          strokes: layer.strokes.filter((stroke) => stroke.id !== action.strokeId),
        })),
      );

    case 'add-layer':
      return touch(
        mapPage(state, action.pageId, (page) => ({
          ...page,
          layers: reorder([...page.layers, action.layer]),
        })),
      );

    case 'delete-layer':
      return touch(
        mapPage(state, action.pageId, (page) => {
          // Mindestens eine Ebene muss bleiben, sonst kann man nicht mehr zeichnen.
          if (page.layers.length <= 1) return page;
          return {
            ...page,
            layers: reorder(page.layers.filter((layer) => layer.id !== action.layerId)),
          };
        }),
      );

    case 'rename-layer':
      return touch(
        mapLayer(state, action.pageId, action.layerId, (layer) => ({
          ...layer,
          name: action.name,
        })),
      );

    case 'set-layer-visible':
      return touch(
        mapLayer(state, action.pageId, action.layerId, (layer) => ({
          ...layer,
          visible: action.visible,
        })),
      );

    case 'move-layer':
      return touch(
        mapPage(state, action.pageId, (page) => ({
          ...page,
          layers: moveLayer(page.layers, action.layerId, action.direction),
        })),
      );

    case 'insert-page': {
      const pages = [...state.pages];
      const at = action.afterPageId
        ? pages.findIndex((page) => page.id === action.afterPageId) + 1
        : pages.length;
      pages.splice(at <= 0 ? pages.length : at, 0, action.page);
      return touch({ ...state, pages });
    }

    case 'delete-page': {
      if (state.pages.length <= 1) return state;
      return touch({
        ...state,
        pages: state.pages.filter((page) => page.id !== action.pageId),
      });
    }

    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Helfer
// ---------------------------------------------------------------------------

function touch(doc: NotesDocument): NotesDocument {
  return { ...doc, updatedAt: Date.now() };
}

function mapPage(
  doc: NotesDocument,
  pageId: string,
  update: (page: Page) => Page,
): NotesDocument {
  return {
    ...doc,
    pages: doc.pages.map((page) => (page.id === pageId ? update(page) : page)),
  };
}

function mapLayer(
  doc: NotesDocument,
  pageId: string,
  layerId: string,
  update: (layer: InkLayer) => InkLayer,
): NotesDocument {
  return mapPage(doc, pageId, (page) => ({
    ...page,
    layers: page.layers.map((layer) => (layer.id === layerId ? update(layer) : layer)),
  }));
}

/** order-Werte wieder lueckenlos 0..n-1 machen. */
function reorder(layers: InkLayer[]): InkLayer[] {
  return [...layers]
    .sort((a, b) => a.order - b.order)
    .map((layer, index) => (layer.order === index ? layer : { ...layer, order: index }));
}

function moveLayer(layers: InkLayer[], layerId: string, direction: -1 | 1): InkLayer[] {
  const sorted = [...layers].sort((a, b) => a.order - b.order);
  const from = sorted.findIndex((layer) => layer.id === layerId);
  const to = from + direction;
  if (from < 0 || to < 0 || to >= sorted.length) return layers;

  const [moved] = sorted.splice(from, 1);
  sorted.splice(to, 0, moved);
  return reorder(sorted);
}

/** Die oberste sichtbare Ebene – der sinnvollste Fallback fuer "wo wird gezeichnet". */
export function topmostVisibleLayer(page: Page): InkLayer | null {
  const visible = page.layers.filter((layer) => layer.visible);
  if (visible.length === 0) return null;
  return visible.reduce((best, layer) => (layer.order > best.order ? layer : best));
}

export function findPage(doc: NotesDocument, pageId: string | null): Page | null {
  if (!pageId) return null;
  return doc.pages.find((page) => page.id === pageId) ?? null;
}
