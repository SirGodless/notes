import { memo, useEffect } from 'react';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';

import { PAGE_HEIGHT, PAGE_PADDING, PAGE_WIDTH } from '../config';
import type { TextDoc } from '../model/types';

interface TextLayerProps {
  pageId: string;
  /** Startinhalt. Danach ist Tiptap die fuehrende Quelle – wir spiegeln nur
   *  zurueck ins Dokument. Ein Zurueckschreiben von aussen wuerde bei jedem
   *  Tastendruck den Cursor verlieren. */
  initialText: TextDoc;
  zoom: number;
  onChange: (text: TextDoc) => void;
  onEditorReady: (editor: Editor | null) => void;
  onFocus: () => void;
}

/**
 * Der Fliesstext einer Seite.
 *
 * Die Undo/Redo-Extension bleibt aktiv – wir brauchen ihren Stapel – aber die
 * Tastenkuerzel fangen wir global ab (siehe AppState), damit Strg+Z je nach
 * letzter Aktion entweder hier oder in der Tinte landet.
 */
export const TextLayer = memo(function TextLayer({
  pageId,
  initialText,
  zoom,
  onChange,
  onEditorReady,
  onFocus,
}: TextLayerProps) {
  const editor = useEditor(
    {
      extensions: [StarterKit],
      content: initialText,
      onUpdate: ({ editor: instance }) => onChange(instance.getJSON() as TextDoc),
      onFocus,
      editorProps: {
        attributes: {
          class: 'text-layer-content',
          spellcheck: 'false',
        },
      },
    },
    [pageId],
  );

  useEffect(() => {
    onEditorReady(editor);
    return () => onEditorReady(null);
  }, [editor, onEditorReady]);

  return (
    <div
      className="text-layer"
      style={{
        width: PAGE_WIDTH,
        height: PAGE_HEIGHT,
        padding: PAGE_PADDING,
        // Der Text wird mitskaliert, damit er im selben Koordinatenraum lebt
        // wie die Tinte. Sonst wuerde beim Zoomen beides auseinanderlaufen.
        transform: `scale(${zoom})`,
        transformOrigin: '0 0',
      }}
    >
      <EditorContent editor={editor} />
    </div>
  );
});
