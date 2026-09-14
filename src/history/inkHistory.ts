import { MAX_UNDO_DEPTH } from '../config';
import type { Stroke } from '../model/types';

/**
 * Ein Undo-Schritt der Tinte.
 *
 * Bewusst operationsbasiert und nicht als ImageData-Schnappschuss: A4 bei
 * Renderfaktor 2 sind 794*2 x 1123*2 x 4 Byte, also rund 14 MB – pro
 * Schnappschuss. Bei "vorher und nachher" pro Geste waere der Speicher nach
 * ein paar Radierern voll.
 *
 * Stattdessen merken wir uns nur, welcher Strich an welcher Position dazukam.
 * Rueckgaengig heisst dann: Strich raus, Ebene aus der Strichliste neu
 * aufbauen. Das kostet bei ein paar tausend Strichen einmalig einige
 * Millisekunden – fuer einen Tastendruck voellig unkritisch, und es passiert
 * nie waehrend des Zeichnens.
 */
export interface InkHistoryEntry {
  action: 'draw' | 'erase';
  pageId: string;
  layerId: string;
  stroke: Stroke;
  /** Position in der Strichliste, damit Redo exakt wieder einfuegt. */
  index: number;
}

export class InkHistory {
  private undoStack: InkHistoryEntry[] = [];
  private redoStack: InkHistoryEntry[] = [];

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  push(entry: InkHistoryEntry): void {
    this.undoStack.push(entry);
    if (this.undoStack.length > MAX_UNDO_DEPTH) this.undoStack.shift();
    // Jede neue Aktion macht den Redo-Zweig ungueltig.
    this.redoStack.length = 0;
  }

  popUndo(): InkHistoryEntry | null {
    const entry = this.undoStack.pop();
    if (!entry) return null;
    this.redoStack.push(entry);
    return entry;
  }

  popRedo(): InkHistoryEntry | null {
    const entry = this.redoStack.pop();
    if (!entry) return null;
    this.undoStack.push(entry);
    return entry;
  }

  clear(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
  }

  /** Entfernt Eintraege zu geloeschten Seiten/Ebenen, damit Undo nicht ins Leere greift. */
  forget(predicate: (entry: InkHistoryEntry) => boolean): void {
    this.undoStack = this.undoStack.filter((entry) => !predicate(entry));
    this.redoStack = this.redoStack.filter((entry) => !predicate(entry));
  }
}
