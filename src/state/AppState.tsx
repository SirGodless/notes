import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { Editor } from '@tiptap/react';

import { createDocument, createLayer, createPage } from '../model/factory';
import type { NotesDocument, Page, Stroke, TextDoc } from '../model/types';
import { documentReducer, findPage, topmostVisibleLayer, type DocumentAction } from './documentReducer';
import { initialToolState, type ToolState } from './toolState';
import { InkHistory } from '../history/inkHistory';
import { HistoryRouter } from '../history/historyRouter';
import { useAutosave, type SaveState } from '../storage/autosave';
import { loadLastOpenedDocument } from '../storage/db';
import { exportDocument, importDocumentFromFile } from '../storage/fileIO';

interface AppContextValue {
  doc: NotesDocument;
  dispatch: React.Dispatch<DocumentAction>;

  tool: ToolState;
  /** Immer aktueller Zeichenzustand fuer die Engine – bewusst als Ref, damit
   *  Werkzeugwechsel kein Neuzeichnen der Seiten ausloesen. */
  toolRef: React.RefObject<ToolState>;
  updateTool: (patch: Partial<ToolState>) => void;

  focusedPageId: string;
  focusPage: (pageId: string) => void;

  activeLayerId: (page: Page) => string | null;
  setActiveLayer: (pageId: string, layerId: string) => void;

  commitStroke: (pageId: string, layerId: string, stroke: Stroke) => void;

  registerEditor: (pageId: string, editor: Editor | null) => void;
  noteTextChange: (pageId: string, text: TextDoc) => void;
  isApplyingHistory: React.RefObject<boolean>;

  undo: () => void;
  redo: () => void;

  saveState: SaveState;
  newDocument: () => void;
  openFile: (file: File) => Promise<void>;
  saveToFile: () => void;
  setTitle: (title: string) => void;

  addPage: (afterPageId: string | null) => void;
  deletePage: (pageId: string) => void;
  addLayer: (pageId: string) => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const value = useContext(AppContext);
  if (!value) throw new Error('useApp muss innerhalb von <AppProvider> benutzt werden.');
  return value;
}

/** Verzoegerung, mit der Tiptap-Inhalt ins Dokument gespiegelt wird. */
const TEXT_MIRROR_DEBOUNCE_MS = 400;

export function AppProvider({ children }: { children: ReactNode }) {
  const [doc, dispatch] = useReducer(documentReducer, null, () => createDocument());
  const [ready, setReady] = useState(false);
  const [tool, setTool] = useState<ToolState>(initialToolState);
  const [focusedPageId, setFocusedPageId] = useState<string>(() => doc.pages[0].id);
  const [activeLayers, setActiveLayers] = useState<Record<string, string>>({});

  const toolRef = useRef(tool);
  const inkHistory = useRef(new InkHistory()).current;
  const historyRouter = useRef(new HistoryRouter()).current;
  const editors = useRef(new Map<string, Editor>()).current;
  const lastEditedPageId = useRef<string | null>(null);
  const isApplyingHistory = useRef(false);
  const textMirrorTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>()).current;

  // Immer der aktuelle Dokumentstand fuer Callbacks, die nicht neu gebunden
  // werden sollen (Tastenkuerzel, Datei-Export).
  const docRef = useRef(doc);
  docRef.current = doc;

  // Ref nach dem Commit aktualisieren: die Engine liest ihn nur aus
  // Event-Handlern, also nie waehrend eines Renders.
  useEffect(() => {
    toolRef.current = tool;
  }, [tool]);

  const saveState = useAutosave(ready ? doc : null, ready);

  // --- Start: letztes Dokument aus der Datenbank holen ----------------------
  useEffect(() => {
    let cancelled = false;

    loadLastOpenedDocument()
      .then((stored) => {
        if (cancelled) return;
        if (stored) {
          dispatch({ type: 'load', doc: stored });
          setFocusedPageId(stored.pages[0].id);
        }
      })
      .catch((error) => console.error('Konnte gespeicherten Stand nicht laden:', error))
      .finally(() => {
        if (!cancelled) setReady(true);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // --- Ebenen --------------------------------------------------------------

  const activeLayerId = useCallback(
    (page: Page): string | null => {
      const preferred = activeLayers[page.id];
      const match = page.layers.find((layer) => layer.id === preferred && layer.visible);
      if (match) return match.id;
      return topmostVisibleLayer(page)?.id ?? null;
    },
    [activeLayers],
  );

  const setActiveLayer = useCallback((pageId: string, layerId: string) => {
    setActiveLayers((current) => ({ ...current, [pageId]: layerId }));
  }, []);

  const addLayer = useCallback(
    (pageId: string) => {
      const page = findPage(doc, pageId);
      if (!page) return;
      const layer = createLayer(`Ebene ${page.layers.length + 1}`, page.layers.length);
      dispatch({ type: 'add-layer', pageId, layer });
      setActiveLayer(pageId, layer.id);
    },
    [doc, setActiveLayer],
  );

  // --- Striche -------------------------------------------------------------

  const commitStroke = useCallback(
    (pageId: string, layerId: string, stroke: Stroke) => {
      if (stroke.points.length === 0) return;

      const page = findPage(doc, pageId);
      const layer = page?.layers.find((candidate) => candidate.id === layerId);
      const index = layer ? layer.strokes.length : 0;

      dispatch({ type: 'insert-stroke', pageId, layerId, stroke });
      inkHistory.push({
        action: stroke.tool === 'eraser' ? 'erase' : 'draw',
        pageId,
        layerId,
        stroke,
        index,
      });
      historyRouter.recordInk();
    },
    [doc, historyRouter, inkHistory],
  );

  // --- Text ----------------------------------------------------------------

  const registerEditor = useCallback(
    (pageId: string, editor: Editor | null) => {
      if (editor) editors.set(pageId, editor);
      else editors.delete(pageId);
    },
    [editors],
  );

  const noteTextChange = useCallback(
    (pageId: string, text: TextDoc) => {
      // Aenderungen, die wir selbst durch Undo/Redo ausgeloest haben, duerfen
      // nicht als neue Nutzeraktion in der Reihenfolge landen.
      if (!isApplyingHistory.current) {
        lastEditedPageId.current = pageId;
        historyRouter.recordText();
      }

      // Den Editorinhalt nur gedrosselt ins Dokument spiegeln. Pro Tastendruck
      // zu dispatchen waere verschwendete Arbeit – Tiptap ist waehrenddessen
      // ohnehin die fuehrende Quelle.
      const existing = textMirrorTimers.get(pageId);
      if (existing) clearTimeout(existing);

      textMirrorTimers.set(
        pageId,
        setTimeout(() => {
          textMirrorTimers.delete(pageId);
          dispatch({ type: 'set-page-text', pageId, text });
        }, TEXT_MIRROR_DEBOUNCE_MS),
      );
    },
    [historyRouter, textMirrorTimers],
  );

  useEffect(() => {
    return () => {
      for (const timer of textMirrorTimers.values()) clearTimeout(timer);
      textMirrorTimers.clear();
    };
  }, [textMirrorTimers]);

  // --- Undo / Redo ---------------------------------------------------------

  const textEditor = useCallback((): Editor | null => {
    const preferred = lastEditedPageId.current ?? focusedPageId;
    return editors.get(preferred) ?? editors.get(focusedPageId) ?? null;
  }, [editors, focusedPageId]);

  const undo = useCallback(() => {
    const editor = textEditor();
    const target = historyRouter.takeUndo({
      ink: inkHistory.canUndo,
      text: editor?.can().undo() ?? false,
    });

    if (target === 'ink') {
      const entry = inkHistory.popUndo();
      if (entry) {
        dispatch({
          type: 'remove-stroke',
          pageId: entry.pageId,
          layerId: entry.layerId,
          strokeId: entry.stroke.id,
        });
      }
    } else if (target === 'text' && editor) {
      isApplyingHistory.current = true;
      editor.commands.undo();
      isApplyingHistory.current = false;
    }
  }, [historyRouter, inkHistory, textEditor]);

  const redo = useCallback(() => {
    const editor = textEditor();
    const target = historyRouter.takeRedo({
      ink: inkHistory.canRedo,
      text: editor?.can().redo() ?? false,
    });

    if (target === 'ink') {
      const entry = inkHistory.popRedo();
      if (entry) {
        dispatch({
          type: 'insert-stroke',
          pageId: entry.pageId,
          layerId: entry.layerId,
          stroke: entry.stroke,
          index: entry.index,
        });
      }
    } else if (target === 'text' && editor) {
      isApplyingHistory.current = true;
      editor.commands.redo();
      isApplyingHistory.current = false;
    }
  }, [historyRouter, inkHistory, textEditor]);

  // Tastenkuerzel global und in der Capture-Phase abfangen, damit sie vor
  // Tiptaps eigener Historie greifen – sonst haetten wir zwei konkurrierende
  // Strg+Z.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();

      if (key === 'z' && !event.shiftKey) {
        event.preventDefault();
        event.stopPropagation();
        undo();
      } else if ((key === 'z' && event.shiftKey) || key === 'y') {
        event.preventDefault();
        event.stopPropagation();
        redo();
      } else if (key === 's') {
        event.preventDefault();
        exportDocument(docRef.current);
      }
    };

    document.addEventListener('keydown', onKeyDown, { capture: true });
    return () => document.removeEventListener('keydown', onKeyDown, { capture: true });
  }, [undo, redo]);

  // --- Dokument-Verwaltung -------------------------------------------------

  const resetHistories = useCallback(() => {
    inkHistory.clear();
    historyRouter.reset();
    lastEditedPageId.current = null;
  }, [historyRouter, inkHistory]);

  const newDocument = useCallback(() => {
    const fresh = createDocument();
    dispatch({ type: 'load', doc: fresh });
    setFocusedPageId(fresh.pages[0].id);
    setActiveLayers({});
    resetHistories();
  }, [resetHistories]);

  const openFile = useCallback(
    async (file: File) => {
      const loaded = await importDocumentFromFile(file);
      dispatch({ type: 'load', doc: loaded });
      setFocusedPageId(loaded.pages[0].id);
      setActiveLayers({});
      resetHistories();
    },
    [resetHistories],
  );

  const saveToFile = useCallback(() => exportDocument(docRef.current), []);

  const setTitle = useCallback((title: string) => dispatch({ type: 'set-title', title }), []);

  const addPage = useCallback((afterPageId: string | null) => {
    const page = createPage();
    dispatch({ type: 'insert-page', page, afterPageId });
    setFocusedPageId(page.id);
  }, []);

  const deletePage = useCallback(
    (pageId: string) => {
      dispatch({ type: 'delete-page', pageId });
      // Undo-Eintraege zu einer geloeschten Seite wuerden ins Leere greifen.
      inkHistory.forget((entry) => entry.pageId === pageId);
      editors.delete(pageId);
      if (focusedPageId === pageId) {
        const fallback = docRef.current.pages.find((page) => page.id !== pageId);
        if (fallback) setFocusedPageId(fallback.id);
      }
    },
    [editors, focusedPageId, inkHistory],
  );

  const updateTool = useCallback((patch: Partial<ToolState>) => {
    setTool((current) => ({ ...current, ...patch }));
  }, []);

  const focusPage = useCallback((pageId: string) => setFocusedPageId(pageId), []);

  // Falls die fokussierte Seite verschwunden ist (Datei geladen, Seite
  // geloescht), auf die erste vorhandene zurueckfallen.
  useEffect(() => {
    if (!doc.pages.some((page) => page.id === focusedPageId)) {
      setFocusedPageId(doc.pages[0].id);
    }
  }, [doc.pages, focusedPageId]);

  const value = useMemo<AppContextValue>(
    () => ({
      doc,
      dispatch,
      tool,
      toolRef,
      updateTool,
      focusedPageId,
      focusPage,
      activeLayerId,
      setActiveLayer,
      commitStroke,
      registerEditor,
      noteTextChange,
      isApplyingHistory,
      undo,
      redo,
      saveState,
      newDocument,
      openFile,
      saveToFile,
      setTitle,
      addPage,
      deletePage,
      addLayer,
    }),
    [
      doc,
      tool,
      updateTool,
      focusedPageId,
      focusPage,
      activeLayerId,
      setActiveLayer,
      commitStroke,
      registerEditor,
      noteTextChange,
      undo,
      redo,
      saveState,
      newDocument,
      openFile,
      saveToFile,
      setTitle,
      addPage,
      deletePage,
      addLayer,
    ],
  );

  if (!ready) {
    return <div className="boot-screen">Notizen werden geladen …</div>;
  }

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
