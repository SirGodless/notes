/**
 * Liefert den Vite-Build (dist/) aus, mit SPA-Fallback auf index.html fuer
 * alles, was keine vorhandene Datei ist – entspricht v1s nginx.conf
 * try_files-Regel, nur in JS statt Nginx-Konfiguration.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

export async function serveStatic(req: IncomingMessage, res: ServerResponse, distDir: string): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  // normalize() loest ".." auf, damit ein Request wie /../../etc/passwd
  // nicht aus dist/ herausfuehrt.
  const requestedPath = normalize(join(distDir, url.pathname));

  const candidate = requestedPath.startsWith(distDir) ? requestedPath : distDir;
  const filePath = (await isFile(candidate)) ? candidate : join(distDir, 'index.html');

  try {
    const content = await readFile(filePath);
    const contentType = MIME_TYPES[extname(filePath)] ?? 'application/octet-stream';
    const immutable = filePath.includes('/assets/');
    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
    res.end(content);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}
