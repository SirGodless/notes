import {
  CURRENT_VERSION,
  type InkLayer,
  type NotesDocument,
  type Page,
  type Stroke,
  type StrokePoint,
  type ToolKind,
} from './types.ts';

/** Kurze, kollisionsarme ID. crypto.randomUUID gibt es in allen Zielbrowsern. */
export function createId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createLayer(name: string, order: number): InkLayer {
  return { id: createId(), name, visible: true, order, strokes: [] };
}

export function createEmptyTextDoc() {
  return { type: 'doc', content: [{ type: 'paragraph' }] };
}

export function createPage(): Page {
  return {
    id: createId(),
    text: createEmptyTextDoc(),
    layers: [createLayer('Ebene 1', 0)],
  };
}

export function createDocument(title = 'Unbenannte Notiz'): NotesDocument {
  return {
    version: CURRENT_VERSION,
    id: createId(),
    title,
    pages: [createPage()],
    updatedAt: Date.now(),
  };
}

export function createStroke(params: {
  color: string;
  width: number;
  tool: ToolKind;
  points?: StrokePoint[];
}): Stroke {
  return {
    id: createId(),
    points: params.points ?? [],
    color: params.color,
    width: params.width,
    tool: params.tool,
  };
}
