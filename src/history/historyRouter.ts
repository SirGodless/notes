import { TEXT_HISTORY_GROUP_MS } from '../config';

export type HistorySource = 'ink' | 'text';

interface TimelineEntry {
  source: HistorySource;
  at: number;
}

/**
 * Text und Tinte haben getrennte Undo-Stapel: den von Tiptap/ProseMirror und
 * unseren eigenen. Strg+Z soll trotzdem das rueckgaengig machen, was der
 * Nutzer zuletzt getan hat – egal welches von beiden das war.
 *
 * Dieser Router fuehrt darum nur eine Reihenfolge mit: "zuletzt Tinte,
 * davor Text, davor Tinte, ...". Beim Undo schaut er nach, welcher Stapel
 * dran ist, und leitet dorthin weiter.
 *
 * Zwei Details, die in der Praxis wichtig sind:
 *
 * 1. ProseMirror fasst schnell aufeinanderfolgende Tastendruecke zu einem
 *    Undo-Schritt zusammen. Der Router muss dieselbe Gruppierung nachbilden,
 *    sonst zaehlt er 50 Text-Schritte, waehrend Tiptap nur 3 kennt – und
 *    Strg+Z wuerde gefuehlt haengen.
 * 2. Ist der laut Reihenfolge zustaendige Stapel leer (z.B. weil Tiptaps
 *    Historie durch ein Dokument-Laden zurueckgesetzt wurde), faellt der
 *    Router auf den anderen zurueck, statt gar nichts zu tun.
 */
export class HistoryRouter {
  private past: TimelineEntry[] = [];
  private future: TimelineEntry[] = [];

  recordInk(): void {
    this.past.push({ source: 'ink', at: performance.now() });
    this.future.length = 0;
  }

  recordText(): void {
    const now = performance.now();
    const last = this.past[this.past.length - 1];

    if (last && last.source === 'text' && now - last.at < TEXT_HISTORY_GROUP_MS) {
      // Gehoert noch zur selben Tipp-Gruppe – kein neuer Schritt.
      last.at = now;
    } else {
      this.past.push({ source: 'text', at: now });
    }
    this.future.length = 0;
  }

  /** Gibt zurueck, welcher Stapel das Undo ausfuehren soll. */
  takeUndo(available: Record<HistorySource, boolean>): HistorySource | null {
    return this.take(this.past, this.future, available);
  }

  takeRedo(available: Record<HistorySource, boolean>): HistorySource | null {
    return this.take(this.future, this.past, available);
  }

  reset(): void {
    this.past.length = 0;
    this.future.length = 0;
  }

  private take(
    from: TimelineEntry[],
    to: TimelineEntry[],
    available: Record<HistorySource, boolean>,
  ): HistorySource | null {
    // Von hinten nach vorne den ersten Eintrag suchen, dessen Stapel auch
    // wirklich etwas zu bieten hat. Alles davor ist verwaist.
    while (from.length > 0) {
      const entry = from[from.length - 1];
      if (available[entry.source]) {
        from.pop();
        to.push(entry);
        return entry.source;
      }
      from.pop();
    }

    // Reihenfolge sagt nichts mehr – dann eben nehmen, was noch da ist.
    if (available.ink) return 'ink';
    if (available.text) return 'text';
    return null;
  }
}
