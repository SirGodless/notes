import { useEffect, useRef, useState } from 'react';
import { AUTOSAVE_DEBOUNCE_MS, AUTOSAVE_MAX_INTERVAL_MS } from '../config';
import { isInputActive } from '../ink/inputActivity';
import type { NotesDocument } from '../model/types';
import { saveDocument } from './db';

export type SaveState = 'idle' | 'pending' | 'saving' | 'saved' | 'error';

/**
 * Schreibt das Dokument nach jeder Aenderung verzoegert in die IndexedDB.
 *
 * Zwei Timer: einer setzt nach jeder Aenderung neu an (damit beim
 * Dauerschreiben nicht dauernd gespeichert wird), der andere sorgt dafuer,
 * dass trotzdem spaetestens alle AUTOSAVE_MAX_INTERVAL_MS geschrieben wird –
 * sonst wuerde eine lange ununterbrochene Schreibphase nie gesichert.
 *
 * Zusaetzlich wird beim Wegblenden des Tabs sofort geschrieben. `pagehide`
 * bzw. `visibilitychange` sind die einzigen Ereignisse, auf die man sich auf
 * Mobilgeraeten verlassen kann – `beforeunload` feuert dort oft nicht.
 */
/** Wie oft nachgeschaut wird, ob der Stift wieder oben ist. */
const RETRY_WHILE_DRAWING_MS = 250;

export function useAutosave(doc: NotesDocument | null, enabled: boolean): SaveState {
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const docRef = useRef(doc);
  const dirtyRef = useRef(false);
  const deadlineRef = useRef<number | null>(null);

  docRef.current = doc;

  useEffect(() => {
    if (!doc || !enabled) return;

    dirtyRef.current = true;
    setSaveState('pending');

    if (deadlineRef.current === null) {
      deadlineRef.current = Date.now() + AUTOSAVE_MAX_INTERVAL_MS;
    }

    const waitFor = Math.max(0, Math.min(AUTOSAVE_DEBOUNCE_MS, deadlineRef.current - Date.now()));

    let timer = setTimeout(function attempt() {
      // Waehrend eines Strichs nicht speichern – siehe ink/inputActivity.ts.
      if (isInputActive()) {
        timer = setTimeout(attempt, RETRY_WHILE_DRAWING_MS);
        return;
      }
      deadlineRef.current = null;
      void flush();
    }, waitFor);

    return () => clearTimeout(timer);

    async function flush() {
      const current = docRef.current;
      if (!current) return;
      setSaveState('saving');
      try {
        await saveDocument(current);
        dirtyRef.current = false;
        setSaveState('saved');
      } catch (error) {
        console.error('Autosave fehlgeschlagen:', error);
        setSaveState('error');
      }
    }
  }, [doc, enabled]);

  useEffect(() => {
    if (!enabled) return;

    const saveNow = () => {
      const current = docRef.current;
      if (current && dirtyRef.current) void saveDocument(current).catch(() => undefined);
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') saveNow();
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pagehide', saveNow);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pagehide', saveNow);
    };
  }, [enabled]);

  return saveState;
}
