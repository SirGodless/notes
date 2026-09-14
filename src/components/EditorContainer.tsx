import { useCallback, useEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';

import { PointerRouter } from '../ink/pointerRouter';
import type { Stroke, TextDoc } from '../model/types';
import { useApp } from '../state/AppState';
import { PageView } from './PageView';

/**
 * Der scrollbare Arbeitsbereich mit allen Seiten untereinander.
 *
 * Der Palm-Rejection-Router lebt hier und nicht pro Seite: der Handballen
 * liegt beim Schreiben am oberen Rand einer Seite regelmaessig noch auf der
 * darueber. Eine gemeinsame Instanz sorgt dafuer, dass die Sperre dokumentweit
 * gilt.
 */
export function EditorContainer() {
  const {
    doc,
    tool,
    toolRef,
    focusedPageId,
    focusPage,
    activeLayerId,
    commitStroke,
    registerEditor,
    noteTextChange,
    addPage,
  } = useApp();

  const [penActive, setPenActive] = useState(false);
  const router = useRef<PointerRouter | null>(null);

  if (!router.current) {
    router.current = new PointerRouter({ onPenActiveChange: setPenActive });
  }

  useEffect(() => {
    const instance = router.current;
    return () => instance?.dispose();
  }, []);

  const handleStroke = useCallback(
    (pageId: string, layerId: string, stroke: Stroke) => commitStroke(pageId, layerId, stroke),
    [commitStroke],
  );

  return (
    <main className={`workspace${penActive ? ' pen-active' : ''}`}>
      <div className="page-stack" key={doc.id}>
        {doc.pages.map((page, index) => (
          <PageViewBinding
            key={page.id}
            pageIndex={index}
            total={doc.pages.length}
            zoom={tool.zoom}
            penActive={penActive}
            router={router.current!}
            toolRef={toolRef}
            page={doc.pages[index]}
            activeLayer={activeLayerId(page)}
            isFocused={page.id === focusedPageId}
            onFocus={focusPage}
            onStroke={handleStroke}
            onText={noteTextChange}
            onEditor={registerEditor}
          />
        ))}

        <button type="button" className="add-page" onClick={() => addPage(null)}>
          + Seite anhängen
        </button>
      </div>
    </main>
  );
}

/**
 * Bindet die seitenbezogenen Callbacks. Eigene Komponente, damit die an
 * PageView uebergebenen Funktionen pro Seite stabil bleiben und React das
 * memo() von PageView nicht bei jedem Render verwirft.
 */
interface BindingProps {
  page: Parameters<typeof PageView>[0]['page'];
  pageIndex: number;
  total: number;
  zoom: number;
  penActive: boolean;
  router: PointerRouter;
  toolRef: React.RefObject<import('../state/toolState').ToolState>;
  activeLayer: string | null;
  isFocused: boolean;
  onFocus: (pageId: string) => void;
  onStroke: (pageId: string, layerId: string, stroke: Stroke) => void;
  onText: (pageId: string, text: TextDoc) => void;
  onEditor: (pageId: string, editor: Editor | null) => void;
}

function PageViewBinding({
  page,
  pageIndex,
  total,
  zoom,
  penActive,
  router,
  toolRef,
  activeLayer,
  isFocused,
  onFocus,
  onStroke,
  onText,
  onEditor,
}: BindingProps) {
  const pageId = page.id;

  const handleFocus = useCallback(() => onFocus(pageId), [onFocus, pageId]);
  const handleStroke = useCallback(
    (layerId: string, stroke: Stroke) => onStroke(pageId, layerId, stroke),
    [onStroke, pageId],
  );
  const handleText = useCallback((text: TextDoc) => onText(pageId, text), [onText, pageId]);
  const handleEditor = useCallback(
    (editor: Editor | null) => onEditor(pageId, editor),
    [onEditor, pageId],
  );

  return (
    <PageView
      page={page}
      pageNumber={pageIndex + 1}
      totalPages={total}
      zoom={zoom}
      penActive={penActive}
      router={router}
      toolRef={toolRef}
      activeLayerId={activeLayer}
      isFocused={isFocused}
      onFocus={handleFocus}
      onStrokeCommitted={handleStroke}
      onTextChange={handleText}
      onEditorReady={handleEditor}
    />
  );
}
