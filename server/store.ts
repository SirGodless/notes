/**
 * Lese-/Schreiboperationen auf dem Arbeitsbereichs-Verzeichnis.
 *
 * Konflikterkennung ueber ETags: der Client bekommt beim Lesen einen Hash
 * des Dateiinhalts, schickt ihn beim Schreiben per If-Match zurueck. Hat
 * sich die Datei inzwischen geaendert (z.B. vom zweiten Geraet), schlaegt
 * der Schreibvorgang mit 409 fehl, statt die fremde Aenderung still zu
 * ueberschreiben. Reicht fuer einen Nutzer mit zwei Geraeten – fuer echte
 * Mehrbenutzer-Zusammenarbeit waere das zu einfach.
 */

import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { createRootManifest, type IslandManifest } from '../src/model/island.ts';
import { resolveIsland, type ResolvedIsland } from './paths.ts';

/** Eine vom Aufrufer verlangte Operation ist strukturell ungueltig (z.B. Verschieben in sich selbst). */
export class InvalidOperationError extends Error {}

export class IslandNotFoundError extends Error {
  constructor(path: string) {
    super(`Insel nicht gefunden: ${path}`);
    this.name = 'IslandNotFoundError';
  }
}

export class ETagMismatchError extends Error {
  // Kein TS-Parameter-Property (constructor(public readonly x: T)): Node
  // fuehrt den Server ohne Build-Schritt direkt als .ts aus, und dessen
  // Strip-Only-Modus unterstuetzt nur Syntax, die sich ohne Laufzeitcode
  // entfernen laesst – Parameter-Properties erzeugen aber `this.x = x`,
  // sind also nicht "erasable". Deshalb hier explizite Felder + Zuweisung.
  readonly current: IslandManifest;
  readonly currentEtag: string;

  constructor(current: IslandManifest, currentEtag: string) {
    super('Die Insel wurde seit dem letzten Lesen anderswo veraendert.');
    this.name = 'ETagMismatchError';
    this.current = current;
    this.currentEtag = currentEtag;
  }
}

function computeEtag(raw: string): string {
  return createHash('sha256').update(raw).digest('hex').slice(0, 16);
}

export interface ReadResult {
  manifest: IslandManifest;
  etag: string;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await readFile(path);
    return true;
  } catch {
    return false;
  }
}

export class WorkspaceStore {
  private readonly root: string;

  constructor(root: string) {
    this.root = root;
  }

  /** Legt den Arbeitsbereich mit einer leeren Wurzel-Insel an, falls er fehlt. */
  async ensureInitialized(): Promise<void> {
    await mkdir(this.root, { recursive: true });
    const resolved = resolveIsland(this.root, []);
    if (!(await fileExists(resolved.manifestPath))) {
      await this.writeRaw(resolved, createRootManifest());
    }
  }

  async read(idPath: string[]): Promise<ReadResult> {
    const resolved = resolveIsland(this.root, idPath);
    let raw: string;
    try {
      raw = await readFile(resolved.manifestPath, 'utf8');
    } catch {
      throw new IslandNotFoundError(idPath.join('/'));
    }
    return { manifest: JSON.parse(raw) as IslandManifest, etag: computeEtag(raw) };
  }

  /**
   * Schreibt eine Insel. Mit expectedEtag wird geprueft, dass sich seit dem
   * letzten Lesen nichts geaendert hat (ETagMismatchError sonst). Ohne
   * expectedEtag wird unconditional geschrieben – fuer neu angelegte Inseln,
   * die es noch nicht gab.
   */
  async write(
    idPath: string[],
    manifest: IslandManifest,
    expectedEtag?: string,
  ): Promise<string> {
    const resolved = resolveIsland(this.root, idPath);

    if (expectedEtag !== undefined) {
      let current: ReadResult | null = null;
      try {
        current = await this.read(idPath);
      } catch (error) {
        if (!(error instanceof IslandNotFoundError)) throw error;
      }
      if (current && current.etag !== expectedEtag) {
        throw new ETagMismatchError(current.manifest, current.etag);
      }
    }

    return this.writeRaw(resolved, manifest);
  }

  private async writeRaw(resolved: ResolvedIsland, manifest: IslandManifest): Promise<string> {
    await mkdir(dirname(resolved.manifestPath), { recursive: true });
    const raw = JSON.stringify(manifest, null, 2);
    await writeFile(resolved.manifestPath, raw, 'utf8');
    return computeEtag(raw);
  }

  /**
   * Verschiebt eine Insel unter eine neue Eltern-Insel (Mitte-Drop). Reines
   * `rename` auf Ordner-Ebene – der Dateninhalt wird nicht angefasst, nur
   * die Position im Baum. newX/newY werden direkt im Manifest der
   * verschobenen Insel aktualisiert (Rand-Anker-Position beim neuen Eltern).
   */
  async move(idPath: string[], newParentIdPath: string[], newX: number, newY: number): Promise<void> {
    if (idPath.length === 0) throw new InvalidOperationError('Die Wurzel-Insel kann nicht verschoben werden.');

    // Verhindert, dass eine Insel in einen ihrer eigenen Nachfahren verschoben
    // wird – das wuerde einen Zyklus im Baum erzeugen (Ordner in sich selbst).
    const sourcePrefix = idPath.join('/') + '/';
    if ((newParentIdPath.join('/') + '/').startsWith(sourcePrefix)) {
      throw new InvalidOperationError('Eine Insel kann nicht in ihre eigene Kind-Insel verschoben werden.');
    }

    const source = resolveIsland(this.root, idPath);
    const newParent = resolveIsland(this.root, newParentIdPath);
    const id = idPath[idPath.length - 1];
    const target = join(newParent.childrenDir, id);

    await mkdir(newParent.childrenDir, { recursive: true });
    await rename(source.dir, target);

    const newIdPath = [...newParentIdPath, id];
    const { manifest, etag } = await this.read(newIdPath);
    await this.write(newIdPath, { ...manifest, x: newX, y: newY }, etag);
  }

  /**
   * ACHTUNG (fuer Stage E / Rand-Merge): sweepFlaggedForDeletion() entfernt
   * den kompletten Unterbaum rekursiv. Hat die zu flaggende Insel eigene
   * Kind-Inseln, muessen die VOR dem Flaggen per move() zur Zielinsel des
   * Merges umgehaengt werden – sonst gehen sie beim naechsten Serverstart
   * mit verloren. Diese Methode prueft das bewusst nicht selbst, damit sie
   * ein einfacher Baustein bleibt; die Verantwortung liegt beim Aufrufer.
   */
  async flagForDeletion(idPath: string[]): Promise<void> {
    const { manifest, etag } = await this.read(idPath);
    await this.write(idPath, { ...manifest, flaggedForDeletion: true }, etag);
  }

  async unflagDeletion(idPath: string[]): Promise<void> {
    const { manifest, etag } = await this.read(idPath);
    const { flaggedForDeletion: _drop, ...rest } = manifest;
    await this.write(idPath, rest, etag);
  }

  /**
   * Entfernt alle geflaggten Inseln. Wird genau einmal beim Serverstart
   * aufgerufen (siehe server/index.ts) statt bei einem Browser-Ereignis –
   * "Tab schliessen" ist kein zuverlaessiges Signal (siehe v1-Erfahrung mit
   * pagehide/visibilitychange). Jede Insel, die beim Start geflaggt
   * vorgefunden wird, stammt per Definition aus einer frueheren Sitzung.
   */
  async sweepFlaggedForDeletion(): Promise<string[]> {
    const removed: string[] = [];
    await this.walk([], async (idPath, manifest) => {
      if (manifest.flaggedForDeletion) {
        const resolved = resolveIsland(this.root, idPath);
        await rm(resolved.dir, { recursive: true, force: true });
        removed.push(idPath.join('/'));
      }
    });
    return removed;
  }

  /**
   * Leichtgewichtiger Baum fuer /api/tree: nur Position/ID/Name, kein
   * Stroke-/Textinhalt. Fuer sehr grosse Arbeitsbereiche waere hier
   * spaeter ein Seitenindex sinnvoll statt jede island.json zu lesen –
   * fuer eine Einzelnutzer-App erstmal unkritisch.
   */
  async tree(): Promise<TreeNode> {
    // manifest wird durchgereicht statt pro Knoten zweimal gelesen (einmal
    // zum Flag-Check beim Elternteil, einmal beim rekursiven Abstieg).
    const build = async (idPath: string[], manifest: IslandManifest): Promise<TreeNode> => {
      const resolved = resolveIsland(this.root, idPath);
      const childIds = await this.listChildIds(resolved.childrenDir);

      const children: TreeNode[] = [];
      for (const childId of childIds) {
        const childIdPath = [...idPath, childId];
        const { manifest: childManifest } = await this.read(childIdPath);
        // Eine geflaggte Insel ist aus der Anzeige ausgeblendet (siehe
        // flagForDeletion) – deshalb hier pruefen, NICHT am Elternteil.
        if (childManifest.flaggedForDeletion) continue;
        children.push(await build(childIdPath, childManifest));
      }

      return {
        id: manifest.id,
        name: manifest.name,
        x: manifest.x,
        y: manifest.y,
        z: manifest.z,
        flaggedForDeletion: manifest.flaggedForDeletion ?? false,
        children,
      };
    };

    const { manifest: rootManifest } = await this.read([]);
    return build([], rootManifest);
  }

  private async walk(
    idPath: string[],
    visit: (idPath: string[], manifest: IslandManifest) => Promise<void>,
  ): Promise<void> {
    const { manifest } = await this.read(idPath);
    await visit(idPath, manifest);

    const resolved = resolveIsland(this.root, idPath);
    const childIds = await this.listChildIds(resolved.childrenDir);
    for (const childId of childIds) {
      await this.walk([...idPath, childId], visit);
    }
  }

  private async listChildIds(childrenDir: string): Promise<string[]> {
    try {
      const entries = await readdir(childrenDir, { withFileTypes: true });
      return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
    } catch {
      return [];
    }
  }
}

export interface TreeNode {
  id: string;
  name: string;
  x: number;
  y: number;
  z: number;
  flaggedForDeletion: boolean;
  children: TreeNode[];
}
