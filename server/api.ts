/**
 * HTTP-Routing fuer die Datei-API. Bewusst ohne Framework (node:http reicht
 * fuer fuenf Endpunkte) – keine zusaetzliche Laufzeit-Abhaengigkeit fuer
 * einen so kleinen Oberflaechenbereich.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';

import type { IslandManifest } from '../src/model/island.ts';
import { ETagMismatchError, InvalidOperationError, IslandNotFoundError, WorkspaceStore } from './store.ts';
import { InvalidIslandPathError, parseIdPath } from './paths.ts';

function sendJson(res: ServerResponse, status: number, body: unknown, etag?: string): void {
  const raw = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(raw),
    ...(etag ? { ETag: etag } : {}),
  });
  res.end(raw);
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw.length > 0 ? JSON.parse(raw) : {};
}

/**
 * Versucht die Request als /api/...-Aufruf zu behandeln. Gibt false zurueck,
 * wenn die URL nicht unter /api liegt (dann ist der Aufrufer fuer das
 * Ausliefern der statischen Dateien zustaendig).
 */
export async function handleApiRequest(
  req: IncomingMessage,
  res: ServerResponse,
  store: WorkspaceStore,
): Promise<boolean> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (!url.pathname.startsWith('/api/')) return false;

  try {
    if (url.pathname === '/api/tree' && req.method === 'GET') {
      sendJson(res, 200, await store.tree());
      return true;
    }

    const islandMatch = url.pathname.match(/^\/api\/island(\/.*)?$/);
    if (islandMatch) {
      const remainder = islandMatch[1] ?? '';

      // /api/island/<id>/.../move und .../flag-delete haben eigene Methoden,
      // die restliche ID-Kette also noch vom Suffix befreien.
      const moveMatch = remainder.match(/^(.*)\/move$/);
      const flagMatch = remainder.match(/^(.*)\/flag-delete$/);
      const unflagMatch = remainder.match(/^(.*)\/unflag-delete$/);

      if (moveMatch && req.method === 'POST') {
        const idPath = parseIdPath(moveMatch[1]);
        const body = (await readBody(req)) as { newParentIdPath: string[]; x: number; y: number };
        await store.move(idPath, body.newParentIdPath, body.x, body.y);
        res.writeHead(204);
        res.end();
        return true;
      }

      if (flagMatch && req.method === 'POST') {
        await store.flagForDeletion(parseIdPath(flagMatch[1]));
        res.writeHead(204);
        res.end();
        return true;
      }

      if (unflagMatch && req.method === 'POST') {
        await store.unflagDeletion(parseIdPath(unflagMatch[1]));
        res.writeHead(204);
        res.end();
        return true;
      }

      const idPath = parseIdPath(remainder);

      if (req.method === 'GET') {
        const { manifest, etag } = await store.read(idPath);
        sendJson(res, 200, manifest, etag);
        return true;
      }

      if (req.method === 'PUT') {
        const manifest = await readBody(req);
        const expectedEtag = req.headers['if-match'];
        const etag = await store.write(
          idPath,
          manifest as IslandManifest,
          typeof expectedEtag === 'string' ? expectedEtag : undefined,
        );
        sendJson(res, 200, { ok: true }, etag);
        return true;
      }
    }

    sendJson(res, 404, { error: 'Unbekannte Route.' });
    return true;
  } catch (error) {
    if (error instanceof ETagMismatchError) {
      sendJson(res, 409, { error: 'conflict', current: error.current }, error.currentEtag);
      return true;
    }
    if (error instanceof IslandNotFoundError) {
      sendJson(res, 404, { error: 'not_found' });
      return true;
    }
    if (error instanceof InvalidIslandPathError) {
      sendJson(res, 400, { error: 'invalid_path' });
      return true;
    }
    if (error instanceof InvalidOperationError) {
      sendJson(res, 400, { error: 'invalid_operation', message: error.message });
      return true;
    }
    console.error(error);
    sendJson(res, 500, { error: 'internal_error' });
    return true;
  }
}
