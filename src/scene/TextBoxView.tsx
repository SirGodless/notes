import { memo, useEffect } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';

import type { TextBox } from '../model/island';
import type { TextDoc } from '../model/types';
import { BODY_CSS_FONT, getGridSpacing } from './baselineGrid';
import { charsToPixelWidth } from './textMetrics';

interface TextBoxViewProps {
  textBox: TextBox;
  /** Nur fuer eine Box, die GERADE JETZT durch eine Nutzeraktion entstanden ist (siehe IslandView). */
  autofocus?: boolean;
  onChange: (content: TextDoc) => void;
  onFocus: () => void;
}

/**
 * Eine einzelne Textbox – anders als v1 (ein Tiptap-Editor pro Seite) kann
 * eine Insel mehrere davon haben, frei positioniert.
 *
 * Breite kommt aus measureChars (Zielbreite in echten Zeichen, ueber
 * TextMetrics in Pixel umgerechnet, NICHT ueber CSS "ch" – siehe
 * textMetrics.ts). Position rastet bei snapToBaselineGrid auf das globale
 * Grundlinienraster ein (siehe baselineGrid.ts, applyGridRhythm.ts fuer die
 * tatsaechliche Zeilenhoehen-Umsetzung per CSS Custom Properties).
 */
export const TextBoxView = memo(function TextBoxView({ textBox, autofocus, onChange, onFocus }: TextBoxViewProps) {
  const editor = useEditor(
    {
      extensions: [StarterKit],
      content: textBox.content,
      autofocus: autofocus ? 'end' : false,
      onUpdate: ({ editor: instance }) => onChange(instance.getJSON() as TextDoc),
      onFocus,
      editorProps: {
        attributes: { class: 'textbox-content', spellcheck: 'false' },
      },
    },
    [textBox.id],
  );

  // Editor beim Unmount sauber freigeben (Tiptap-Instanzen sind nicht billig).
  useEffect(() => () => editor?.destroy(), [editor]);

  const width = charsToPixelWidth(textBox.measureChars, BODY_CSS_FONT);
  const top = textBox.snapToBaselineGrid
    ? Math.round(textBox.y / getGridSpacing()) * getGridSpacing()
    : textBox.y;

  return (
    <div
      className="textbox"
      data-textbox-id={textBox.id}
      style={{ position: 'absolute', left: textBox.x, top, width }}
    >
      <EditorContent editor={editor} />
    </div>
  );
});
