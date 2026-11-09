/**
 * Uebersetzt eine Insel-ID-Kette (aus der URL) in echte Dateisystempfade,
 * und zwar so, dass niemand ueber die API an Dateien ausserhalb des
 * Arbeitsbereichs herankommt.
 *
 * Eine Insel ist ein Ordner: workspaceRoot/islands/<id>/islands/<id>/...
 * Die Wurzel (das Meer) ist workspaceRoot selbst, idPath = [].
 */

import { join, resolve } from 'node:path';

/**
 * Gueltige Insel-IDs sind entweder crypto.randomUUID()-Strings oder das
 * Fallback-Format aus createId() (Zeitstempel-Base36 + Zufalls-Suffix,
 * durch Bindestrich getrennt). Keine Punkte, keine Schraegstriche – damit
 * ist ".." als Segment per Konstruktion bereits ausgeschlossen.
 */
const ID_PATTERN = /^[A-Za-z0-9_-]{1,100}$/;

export class InvalidIslandPathError extends Error {
  constructor(segment: string) {
    super(`Ungueltiges Pfadsegment: "${segment}"`);
    this.name = 'InvalidIslandPathError';
  }
}

/** Zerlegt den Rest-Pfad einer Request-URL (nach /api/island) in eine ID-Kette. */
export function parseIdPath(urlRemainder: string): string[] {
  const segments = urlRemainder.split('/').filter((segment) => segment.length > 0);
  for (const segment of segments) {
    if (!ID_PATTERN.test(segment)) throw new InvalidIslandPathError(segment);
  }
  return segments;
}

export interface ResolvedIsland {
  /** Ordner dieser Insel selbst. */
  dir: string;
  /** dir/island.json */
  manifestPath: string;
  /** dir/islands – Ordner fuer Kind-Inseln (muss nicht existieren). */
  childrenDir: string;
}

/**
 * Loest eine ID-Kette zu echten Pfaden auf. Wirft, falls das Ergebnis aus
 * irgendeinem Grund den Arbeitsbereich verlassen wuerde – bei der
 * Regex-Pruefung oben kann das eigentlich nicht passieren, das ist hier
 * trotzdem als zweite, unabhaengige Absicherung drin (defense in depth).
 */
export function resolveIsland(workspaceRoot: string, idPath: string[]): ResolvedIsland {
  const root = resolve(workspaceRoot);
  let dir = root;
  for (const id of idPath) {
    dir = join(dir, 'islands', id);
  }

  const resolvedDir = resolve(dir);
  if (resolvedDir !== root && !resolvedDir.startsWith(root + '/')) {
    throw new InvalidIslandPathError(idPath.join('/'));
  }

  return {
    dir: resolvedDir,
    manifestPath: join(resolvedDir, 'island.json'),
    childrenDir: join(resolvedDir, 'islands'),
  };
}
