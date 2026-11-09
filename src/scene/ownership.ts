/**
 * Entscheidet, welche Insel einen Strich/Text bekommt, wenn mehrere Inseln
 * sich geometrisch ueberlappen (siehe Plan: "Inseln wachsen frei, kein
 * automatisches Verschieben... Welche Insel einen Strich bekommt,
 * entscheidet die Stapelreihenfolge").
 *
 * Rekursiv aufgebaut, obwohl es bis Stage E keine verschachtelten Inseln
 * gibt (children ist dann immer leer) – damit Stage E hier nichts umbauen
 * muss, nur die children-Liste befuellen.
 */

export interface IslandHitNode {
  id: string;
  z: number;
  /** Bildschirm-Koordinaten (clientX/Y), NICHT insel-lokal. */
  containsScreenPoint(clientX: number, clientY: number): boolean;
  /** Wird vom zentralen Dispatcher (SeaView) auf dem Gewinner-Knoten aufgerufen. */
  handlePointerDown(event: PointerEvent): void;
  /** Verschachtelte Kind-Inseln, bis Stage E immer []. */
  children: IslandHitNode[];
}

/**
 * Unter den Kandidaten auf EINER Ebene gewinnt die zuletzt beruehrte (hoechstes z).
 * Gewinnt eine Insel, wird rekursiv in ihre Kinder abgestiegen – trifft keines
 * davon, bleibt die Insel selbst der Treffer (der Punkt liegt dann in ihrem
 * eigenen Bereich, ausserhalb aller Kind-Inseln).
 */
export function resolveOwner(nodes: readonly IslandHitNode[], clientX: number, clientY: number): IslandHitNode | null {
  const candidates = nodes.filter((n) => n.containsScreenPoint(clientX, clientY));
  if (candidates.length === 0) return null;

  const winner = candidates.reduce((best, n) => (n.z > best.z ? n : best));
  return resolveOwner(winner.children, clientX, clientY) ?? winner;
}
