import { migrateDocument } from '../model/migrations';
import type { NotesDocument } from '../model/types';

/**
 * Liest eine v1-Exportdatei (.json) ein – genutzt vom v2-Import-Button
 * (siehe scene/SeaView.tsx importV1File, model/migrations.ts migrateV1ToV2).
 * v1s eigener exportDocument()-Download ist mit v1 selbst entfallen (Stage F
 * Cutover) – v2 speichert laufend ins Backend, ein manueller Export ist dafuer
 * nicht mehr noetig.
 */
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
