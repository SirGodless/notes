import { migrateDocument } from '../model/migrations';
import type { NotesDocument } from '../model/types';

/** Dateiname aus dem Titel ableiten, ohne im Dateisystem Aerger zu machen. */
function toFileName(title: string): string {
  const cleaned = title.trim().replace(/[^\p{L}\p{N} _-]/gu, '').replace(/\s+/g, '-');
  return `${cleaned || 'notiz'}.json`;
}

export function exportDocument(doc: NotesDocument): void {
  const payload = JSON.stringify({ ...doc, updatedAt: Date.now() }, null, 2);
  const blob = new Blob([payload], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = toFileName(doc.title);
  document.body.appendChild(link);
  link.click();
  link.remove();

  // Erst im naechsten Tick freigeben – sonst bricht der Download in Firefox ab.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export async function importDocumentFromFile(file: File): Promise<NotesDocument> {
  const text = await file.text();

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('Die Datei enthaelt kein gueltiges JSON.');
  }

  // Laeuft durch dieselbe Migration wie ein Dokument aus der Datenbank –
  // eine exportierte Datei aus einer aelteren Version laesst sich also
  // jederzeit wieder oeffnen.
  return migrateDocument(parsed);
}
