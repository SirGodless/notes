/**
 * Einstiegspunkt: liefert die gebaute App und die Datei-API aus einem
 * einzigen Node-Prozess. Laeuft direkt als .ts (Node 22 entfernt
 * TypeScript-Syntax zur Laufzeit, ohne separaten Build-Schritt fuer den
 * Server noetig zu machen – geprueft gegen die hier installierte
 * Node-Version).
 */

import { createServer } from 'node:http';
import { join } from 'node:path';

import { handleApiRequest } from './api.ts';
import { serveStatic } from './staticFiles.ts';
import { WorkspaceStore } from './store.ts';

const PORT = Number(process.env.PORT ?? 3000);
const WORKSPACE_DIR = process.env.WORKSPACE_DIR ?? join(process.cwd(), 'data');
const DIST_DIR = process.env.DIST_DIR ?? join(process.cwd(), 'dist');

async function main(): Promise<void> {
  const store = new WorkspaceStore(WORKSPACE_DIR);
  await store.ensureInitialized();

  // Aufraeumen geflaggter Inseln passiert einmal beim Start, nicht bei einem
  // Browser-Ereignis (siehe server/store.ts: sweepFlaggedForDeletion).
  const removed = await store.sweepFlaggedForDeletion();
  if (removed.length > 0) {
    console.log(`Aufgeraeumt: ${removed.length} geflaggte Insel(n) entfernt.`);
  }

  const server = createServer((req, res) => {
    handleApiRequest(req, res, store)
      .then((handled) => {
        if (!handled) return serveStatic(req, res, DIST_DIR);
      })
      .catch((error) => {
        console.error('Unerwarteter Fehler:', error);
        if (!res.headersSent) res.writeHead(500);
        res.end('Internal error');
      });
  });

  server.listen(PORT, () => {
    console.log(`Notes-Server laeuft auf Port ${PORT}`);
    console.log(`Arbeitsbereich: ${WORKSPACE_DIR}`);
  });
}

main().catch((error) => {
  console.error('Server konnte nicht starten:', error);
  process.exit(1);
});
