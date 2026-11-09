/**
 * Duenner HTTP-Client fuer die Datei-API aus Stage A (server/api.ts).
 *
 * Bewusst ohne Abstraktionsschicht (kein Request-Cache, kein Retry) – das
 * ist fuer eine Einzelnutzer-App mit zwei Geraeten nicht noetig. Konflikte
 * werden als ETagConflictError sichtbar gemacht, statt sie zu verstecken.
 */

import type { IslandManifest } from '../model/island';

export interface TreeNode {
  id: string;
  name: string;
  x: number;
  y: number;
  z: number;
  flaggedForDeletion: boolean;
  children: TreeNode[];
}

export class ETagConflictError extends Error {
  constructor(public readonly current: IslandManifest) {
    super('Die Insel wurde seit dem letzten Lesen anderswo veraendert.');
    this.name = 'ETagConflictError';
  }
}

/** '' fuer die Wurzel (das Meer), sonst eine Kette von Insel-IDs. */
export type IdPath = string[];

function islandUrl(idPath: IdPath): string {
  return `/api/island${idPath.length > 0 ? '/' + idPath.join('/') : ''}`;
}

export async function fetchTree(): Promise<TreeNode> {
  const response = await fetch('/api/tree');
  if (!response.ok) throw new Error(`Baum konnte nicht geladen werden: ${response.status}`);
  return response.json();
}

export interface ReadResult {
  manifest: IslandManifest;
  etag: string;
}

export async function fetchIsland(idPath: IdPath): Promise<ReadResult> {
  const response = await fetch(islandUrl(idPath));
  if (!response.ok) throw new Error(`Insel konnte nicht geladen werden: ${response.status}`);
  const manifest = (await response.json()) as IslandManifest;
  return { manifest, etag: response.headers.get('ETag') ?? '' };
}

/**
 * Schreibt eine Insel. Mit expectedEtag wird ein Konflikt erkannt statt
 * fremde Aenderungen still zu ueberschreiben (siehe server/store.ts).
 * Gibt den neuen ETag zurueck.
 */
export async function putIsland(
  idPath: IdPath,
  manifest: IslandManifest,
  expectedEtag?: string,
): Promise<string> {
  const response = await fetch(islandUrl(idPath), {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      ...(expectedEtag ? { 'If-Match': expectedEtag } : {}),
    },
    body: JSON.stringify(manifest),
  });

  if (response.status === 409) {
    const body = (await response.json()) as { current: IslandManifest };
    throw new ETagConflictError(body.current);
  }
  if (!response.ok) throw new Error(`Insel konnte nicht gespeichert werden: ${response.status}`);

  return response.headers.get('ETag') ?? '';
}

/**
 * Gibt den NEUEN ETag der verschobenen Insel zurueck – move() schreibt sie
 * serverseitig neu (wegen x/y), ein Aufrufer, der weiter den ALTEN ETag
 * benutzt, wuerde beim naechsten eigenen PUT faelschlich einen 409-Konflikt
 * bekommen (siehe SeaView.finishIslandDrag/undo).
 */
export async function moveIsland(idPath: IdPath, newParentIdPath: IdPath, x: number, y: number): Promise<string> {
  const response = await fetch(`${islandUrl(idPath)}/move`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ newParentIdPath, x, y }),
  });
  if (!response.ok) throw new Error(`Insel konnte nicht verschoben werden: ${response.status}`);
  return response.headers.get('ETag') ?? '';
}

export async function flagIslandForDeletion(idPath: IdPath): Promise<void> {
  const response = await fetch(`${islandUrl(idPath)}/flag-delete`, { method: 'POST' });
  if (!response.ok) throw new Error(`Insel konnte nicht geflaggt werden: ${response.status}`);
}

/** Macht flagIslandForDeletion rueckgaengig (Stage E: Merge per Strg+Z zuruecknehmen). */
export async function unflagIslandForDeletion(idPath: IdPath): Promise<void> {
  const response = await fetch(`${islandUrl(idPath)}/unflag-delete`, { method: 'POST' });
  if (!response.ok) throw new Error(`Insel-Flag konnte nicht entfernt werden: ${response.status}`);
}
