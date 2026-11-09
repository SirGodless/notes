import type { StrokePoint } from '../model/types';

export interface Vec2 {
  x: number;
  y: number;
}

export function midpoint(a: Vec2, b: Vec2): Vec2 {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

export function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/** Achsenparalleles Rechteck, das alle Punkte eines Strichs umschliesst. */
export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function boundsOf(points: readonly StrokePoint[], padding = 0): Bounds | null {
  if (points.length === 0) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const point of points) {
    if (point.x < minX) minX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.x > maxX) maxX = point.x;
    if (point.y > maxY) maxY = point.y;
  }

  return {
    minX: minX - padding,
    minY: minY - padding,
    maxX: maxX + padding,
    maxY: maxY + padding,
  };
}

/** Beruehren oder ueberlappen sich zwei achsenparallele Rechtecke? */
export function rectsOverlap(a: Bounds, b: Bounds): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

/** Umschliessendes Rechteck ueber mehrere Rechtecke, oder null bei einer leeren Liste. */
export function unionOfBounds(rects: readonly Bounds[]): Bounds | null {
  if (rects.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const rect of rects) {
    if (rect.minX < minX) minX = rect.minX;
    if (rect.minY < minY) minY = rect.minY;
    if (rect.maxX > maxX) maxX = rect.maxX;
    if (rect.maxY > maxY) maxY = rect.maxY;
  }
  return { minX, minY, maxX, maxY };
}
