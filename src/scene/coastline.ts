/**
 * Berechnet die organische Kuestenlinie einer Insel aus ihrem Inhalt.
 *
 * Pipeline (siehe Plan, Abschnitt "Kuestenlinie"):
 *   1. Inhalt (Strich-Huellrechtecke, spaeter Textbox-Rechtecke) auf ein
 *      grobes Raster rastern.
 *   2. Zwei-Pass-Distanztransformation (Chamfer-Approximation).
 *   3. Kontur bei Abstand = KUESTENABSTAND per Marching Squares extrahieren.
 *   4. Chaikin-Glaettung + deterministische Stoerung aus der Insel-ID.
 *
 * Laeuft nur bei Inhaltsaenderung (coastlineDirty), nicht pro Frame. Das
 * Ergebnis ist eine Liste geschlossener Schleifen (eine pro getrennter
 * "Landmasse" – zwei Inhaltsklumpen, die sich naeher als 2x KUESTENABSTAND
 * kommen, verschmelzen dadurch automatisch zu EINER Schleife) plus eine
 * containsPoint()-Funktion fuer Hit-Testing.
 */

import { GRID_CELL_SIZE, KUESTENABSTAND } from '../config';
import type { Bounds } from '../ink/geometry';

export interface Vec2 {
  x: number;
  y: number;
}

export interface CoastlineResult {
  /** Eine geschlossene Punktfolge pro Landmasse, in Insel-lokalen Welteinheiten. */
  loops: Vec2[][];
  /** Umschliessendes Rechteck ueber alle Schleifen (fuer Virtualisierung/Pan). */
  bounds: Bounds | null;
  /** Punkt-in-Polygon-Test gegen alle Schleifen (Jede Schleife = eigene Landmasse). */
  containsPoint(x: number, y: number): boolean;
}

const EMPTY_RESULT: CoastlineResult = {
  loops: [],
  bounds: null,
  containsPoint: () => false,
};

/**
 * Chamfer-Distanztransformation (zwei Durchlaeufe): naehert fuer jede
 * Rasterzelle den euklidischen Abstand zur naechsten belegten Zelle an.
 * Gewichte 1 fuer Nachbarn in Achsenrichtung, sqrt(2) fuer Diagonalen –
 * Standardnaeherung, deutlich billiger als eine exakte euklidische
 * Distanztransformation, fuer eine Kuestenlinie optisch nicht unterscheidbar.
 */
function chamferDistanceTransform(occupied: Uint8Array, width: number, height: number): Float32Array {
  const INF = 1e9;
  const dist = new Float32Array(width * height).fill(INF);
  for (let i = 0; i < occupied.length; i++) if (occupied[i]) dist[i] = 0;

  const ORTHO = 1;
  const DIAG = Math.SQRT2;

  // Vorwaerts: oben-links -> unten-rechts.
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      let d = dist[i];
      if (x > 0) d = Math.min(d, dist[i - 1] + ORTHO);
      if (y > 0) d = Math.min(d, dist[i - width] + ORTHO);
      if (x > 0 && y > 0) d = Math.min(d, dist[i - width - 1] + DIAG);
      if (x < width - 1 && y > 0) d = Math.min(d, dist[i - width + 1] + DIAG);
      dist[i] = d;
    }
  }
  // Rueckwaerts: unten-rechts -> oben-links.
  for (let y = height - 1; y >= 0; y--) {
    for (let x = width - 1; x >= 0; x--) {
      const i = y * width + x;
      let d = dist[i];
      if (x < width - 1) d = Math.min(d, dist[i + 1] + ORTHO);
      if (y < height - 1) d = Math.min(d, dist[i + width] + ORTHO);
      if (x < width - 1 && y < height - 1) d = Math.min(d, dist[i + width + 1] + DIAG);
      if (x > 0 && y < height - 1) d = Math.min(d, dist[i + width - 1] + DIAG);
      dist[i] = d;
    }
  }
  return dist;
}

/** Kanten-Interpolation fuer Marching Squares: wo genau zwischen a und b liegt der Schwellwert? */
function interpolate(a: number, b: number, threshold: number): number {
  if (Math.abs(a - b) < 1e-6) return 0.5;
  return (threshold - a) / (b - a);
}

/**
 * Marching Squares auf dem Distanzfeld: liefert alle Liniensegmente, die
 * dist(x,y) = threshold durchqueren. Segmente sind noch nicht zu
 * geschlossenen Schleifen verbunden (siehe stitchLoops).
 */
function marchingSquares(
  dist: Float32Array,
  width: number,
  height: number,
  threshold: number,
): Array<[Vec2, Vec2]> {
  const segments: Array<[Vec2, Vec2]> = [];

  for (let y = 0; y < height - 1; y++) {
    for (let x = 0; x < width - 1; x++) {
      const tl = dist[y * width + x];
      const tr = dist[y * width + x + 1];
      const bl = dist[(y + 1) * width + x];
      const br = dist[(y + 1) * width + x + 1];

      // Bit gesetzt = "innerhalb" (Abstand <= Schwelle).
      const code =
        (tl <= threshold ? 1 : 0) |
        (tr <= threshold ? 2 : 0) |
        (br <= threshold ? 4 : 0) |
        (bl <= threshold ? 8 : 0);
      if (code === 0 || code === 15) continue;

      // Kantenpunkte (top/right/bottom/left) per linearer Interpolation.
      const top: Vec2 = { x: x + interpolate(tl, tr, threshold), y };
      const right: Vec2 = { x: x + 1, y: y + interpolate(tr, br, threshold) };
      const bottom: Vec2 = { x: x + interpolate(bl, br, threshold), y: y + 1 };
      const left: Vec2 = { x, y: y + interpolate(tl, bl, threshold) };

      // Standard-Marching-Squares-Fallunterscheidung (16 Faelle, zwei davon
      // mehrdeutig – 5 und 10 – dort wird eine der beiden Diagonalen gewaehlt,
      // fuer eine Kuestenlinie ist der Unterschied nicht wahrnehmbar).
      // Ueber Komplementaerpaare (code, 15-code teilen sich dieselben zwei
      // Kanten, da sich an den Eckwerten nichts aendert, nur daran, welche
      // Seite "innerhalb" ist) hergeleitet: 1<->14 links-oben, 2<->13
      // oben-rechts, 3<->12 links-rechts, 4<->11 rechts-unten, 6<->9
      // oben-unten, 7<->8 links-unten. 5 und 10 sind die beiden
      // mehrdeutigen Sattelpunkt-Faelle mit je zwei Segmenten.
      switch (code) {
        case 1: segments.push([left, top]); break;
        case 2: segments.push([top, right]); break;
        case 3: segments.push([left, right]); break;
        case 4: segments.push([right, bottom]); break;
        case 5: segments.push([left, top], [right, bottom]); break;
        case 6: segments.push([top, bottom]); break;
        case 7: segments.push([left, bottom]); break;
        case 8: segments.push([left, bottom]); break;
        case 9: segments.push([top, bottom]); break;
        case 10: segments.push([top, right], [left, bottom]); break;
        case 11: segments.push([right, bottom]); break;
        case 12: segments.push([left, right]); break;
        case 13: segments.push([top, right]); break;
        case 14: segments.push([left, top]); break;
      }
    }
  }
  return segments;
}

/**
 * Verbindet Liniensegmente zu geschlossenen Schleifen, indem Endpunkte mit
 * (quantisiertem) gleichem Ort zusammengefasst werden. Marching Squares
 * erzeugt pro Zelle isolierte Segmente, deren Endpunkte an Zellgrenzen exakt
 * (bis auf Rundung) uebereinstimmen – das reicht fuer korrektes Verketten.
 */
function stitchLoops(segments: Array<[Vec2, Vec2]>): Vec2[][] {
  const key = (p: Vec2) => `${Math.round(p.x * 100)},${Math.round(p.y * 100)}`;

  // Ungerichtete Adjazenz: pro Punkt-Key die Liste seiner Nachbarpunkte.
  const adjacency = new Map<string, Vec2[]>();
  const pointByKey = new Map<string, Vec2>();
  const addAdjacency = (from: Vec2, to: Vec2) => {
    const k = key(from);
    if (!pointByKey.has(k)) pointByKey.set(k, from);
    if (!adjacency.has(k)) adjacency.set(k, []);
    adjacency.get(k)!.push(to);
  };
  for (const [a, b] of segments) {
    addAdjacency(a, b);
    addAdjacency(b, a);
  }

  // WICHTIG: die Kante wird UNGERICHTET als benutzt markiert (sortierte
  // Punkt-Keys). Eine gerichtete Markierung (nur a->b) liesse die
  // Gegenrichtung (b->a) frei – der Walk wuerde dann im naechsten Schritt
  // einfach eine Kante zurueckgehen und faelschlich eine "geschlossene"
  // 2-Punkte-Schleife melden, statt dem Rand weiter zu folgen.
  const edgeKey = (a: Vec2, b: Vec2): string => {
    const ka = key(a), kb = key(b);
    return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
  };
  const usedEdges = new Set<string>();
  const loops: Vec2[][] = [];

  for (const [a] of segments) {
    const startKey = key(a);
    const startPoint = pointByKey.get(startKey)!;
    const neighbors = adjacency.get(startKey);
    if (!neighbors) continue;

    for (const firstNeighbor of neighbors) {
      if (usedEdges.has(edgeKey(startPoint, firstNeighbor))) continue;

      const loop: Vec2[] = [startPoint];
      let current = startPoint;
      let next: Vec2 | null = firstNeighbor;

      while (next) {
        usedEdges.add(edgeKey(current, next));
        loop.push(next);
        current = next;
        if (key(current) === startKey) {
          next = null; // Schleife geschlossen.
          break;
        }
        const options = adjacency.get(key(current));
        // Der Rueckweg zum vorherigen Punkt ist jetzt bereits als benutzt
        // markiert (s.o.), faellt hier also automatisch weg.
        next = options?.find((o) => !usedEdges.has(edgeKey(current, o))) ?? null;
      }

      if (loop.length >= 3 && key(loop[0]) === key(loop[loop.length - 1])) {
        loop.pop(); // Schlusspunkt = Startpunkt, nicht doppelt speichern.
        loops.push(loop);
      }
    }
  }
  return loops;
}

/** Chaikin-Eckenschneiden: macht aus einer eckigen Schleife eine runde. */
function chaikinSmooth(loop: Vec2[], iterations: number): Vec2[] {
  let points = loop;
  for (let iter = 0; iter < iterations; iter++) {
    const next: Vec2[] = [];
    const n = points.length;
    for (let i = 0; i < n; i++) {
      const p0 = points[i];
      const p1 = points[(i + 1) % n];
      next.push({ x: p0.x * 0.75 + p1.x * 0.25, y: p0.y * 0.75 + p1.y * 0.25 });
      next.push({ x: p0.x * 0.25 + p1.x * 0.75, y: p0.y * 0.25 + p1.y * 0.75 });
    }
    points = next;
  }
  return points;
}

/** Seeded Pseudo-Zufallszahl aus einem String (fuer die Kuestenstoerung). */
function hashSeed(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

/**
 * Deterministische, niederfrequente radiale Stoerung um den Flaechenschwer-
 * punkt – macht aus einer glatten Chaikin-Kontur eine, die nach Kueste statt
 * nach Vektorgrafik aussieht. 2-3 Sinus-Terme, Koeffizienten aus der
 * Insel-ID geseedet, also stabil zwischen Frames und Neuladen.
 */
function applyCoastalNoise(loop: Vec2[], islandId: string, loopIndex: number): Vec2[] {
  const cx = loop.reduce((s, p) => s + p.x, 0) / loop.length;
  const cy = loop.reduce((s, p) => s + p.y, 0) / loop.length;

  const terms = [1, 2, 3].map((n) => {
    const seed = hashSeed(`${islandId}:${loopIndex}:${n}`);
    return {
      k: n + 1, // Frequenz: niedrig halten, sonst sieht es gezackt statt organisch aus.
      phase: seed * Math.PI * 2,
      amplitude: (hashSeed(`${islandId}:${loopIndex}:${n}:amp`) * 0.5 + 0.5) * (4 / n),
    };
  });

  return loop.map((p) => {
    const angle = Math.atan2(p.y - cy, p.x - cx);
    let offset = 0;
    for (const t of terms) offset += t.amplitude * Math.sin(t.k * angle + t.phase);
    const r = Math.hypot(p.x - cx, p.y - cy) || 1;
    const factor = 1 + offset / r;
    return { x: cx + (p.x - cx) * factor, y: cy + (p.y - cy) * factor };
  });
}

function loopBounds(loops: Vec2[][]): Bounds | null {
  if (loops.length === 0) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const loop of loops) {
    for (const p of loop) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  }
  return { minX, minY, maxX, maxY };
}

/** Ray-Casting Punkt-in-Polygon (even-odd rule), fuer eine einzelne Schleife. */
function pointInLoop(loop: Vec2[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    const pi = loop[i], pj = loop[j];
    const intersects = pi.y > y !== pj.y > y && x < ((pj.x - pi.x) * (y - pi.y)) / (pj.y - pi.y) + pi.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

/**
 * Berechnet die Kuestenlinie aus einer Liste von Inhalts-Rechtecken
 * (Strich-Huellrechtecke, spaeter auch Textbox-Rechtecke).
 */
export function computeCoastline(contentRects: Bounds[], islandId: string): CoastlineResult {
  if (contentRects.length === 0) return EMPTY_RESULT;

  const PADDING = KUESTENABSTAND + GRID_CELL_SIZE * 2; // Rand fuer die Distanzsuche + Glaettung.

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const r of contentRects) {
    if (r.minX < minX) minX = r.minX;
    if (r.minY < minY) minY = r.minY;
    if (r.maxX > maxX) maxX = r.maxX;
    if (r.maxY > maxY) maxY = r.maxY;
  }

  const rasterMinX = minX - PADDING, rasterMinY = minY - PADDING;
  const width = Math.max(4, Math.ceil((maxX - minX + 2 * PADDING) / GRID_CELL_SIZE));
  const height = Math.max(4, Math.ceil((maxY - minY + 2 * PADDING) / GRID_CELL_SIZE));

  // Sicherheitsgrenze: eine einzelne, absurd grosse Insel soll nicht
  // Hunderte MB Rasterspeicher allozieren. Bei Ueberschreitung lieber eine
  // grobere Zellgroesse als abzustuerzen.
  const MAX_CELLS = 2_000_000;
  const scaleFactor = width * height > MAX_CELLS ? Math.sqrt((width * height) / MAX_CELLS) : 1;
  const cellSize = GRID_CELL_SIZE * scaleFactor;
  const gw = Math.max(4, Math.ceil((maxX - minX + 2 * PADDING) / cellSize));
  const gh = Math.max(4, Math.ceil((maxY - minY + 2 * PADDING) / cellSize));

  const occupied = new Uint8Array(gw * gh);
  for (const r of contentRects) {
    const x0 = Math.max(0, Math.floor((r.minX - rasterMinX) / cellSize));
    const x1 = Math.min(gw - 1, Math.ceil((r.maxX - rasterMinX) / cellSize));
    const y0 = Math.max(0, Math.floor((r.minY - rasterMinY) / cellSize));
    const y1 = Math.min(gh - 1, Math.ceil((r.maxY - rasterMinY) / cellSize));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) occupied[y * gw + x] = 1;
    }
  }

  const dist = chamferDistanceTransform(occupied, gw, gh);
  const thresholdCells = KUESTENABSTAND / cellSize;
  const rawSegments = marchingSquares(dist, gw, gh, thresholdCells);

  // Von Zell- in Insel-lokale Welteinheiten umrechnen.
  const toWorld = (p: Vec2): Vec2 => ({ x: rasterMinX + p.x * cellSize, y: rasterMinY + p.y * cellSize });
  const worldSegments: Array<[Vec2, Vec2]> = rawSegments.map(([a, b]) => [toWorld(a), toWorld(b)]);

  let loops = stitchLoops(worldSegments);
  loops = loops.map((loop, i) => applyCoastalNoise(chaikinSmooth(loop, 2), islandId, i));

  const bounds = loopBounds(loops);
  return {
    loops,
    bounds,
    containsPoint: (x, y) => loops.some((loop) => pointInLoop(loop, x, y)),
  };
}

/** Wandelt die Schleifen in ein SVG-Pfad-d-Attribut um (fuer die Darstellung). */
export function loopsToSvgPath(loops: Vec2[][]): string {
  return loops
    .map((loop) => {
      if (loop.length === 0) return '';
      const [first, ...rest] = loop;
      return `M ${first.x.toFixed(1)} ${first.y.toFixed(1)} ` + rest.map((p) => `L ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ') + ' Z';
    })
    .join(' ');
}
