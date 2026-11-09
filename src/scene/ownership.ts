/**
 * Entscheidet, welche Insel einen Strich/Text/Drop bekommt, wenn mehrere
 * Inseln sich geometrisch ueberlappen (siehe Plan: "Inseln wachsen frei,
 * kein automatisches Verschieben... Welche Insel einen Strich bekommt,
 * entscheidet die Stapelreihenfolge").
 *
 * Seit Stage E (Verschachtelung) flach statt verschachtelt aufgebaut: JEDE
 * Insel (gleich auf welcher Verschachtelungstiefe) meldet sich mit ihrer
 * eigenen `parentId` an derselben Registry an (siehe SceneContext.tsx).
 * resolveOwner baut die Baum-Ebenen bei jedem Aufruf aus `parentId`
 * zusammen, statt dass jede Insel selbst eine `children`-Liste pflegen
 * muesste – einfacher als die urspruengliche rekursive children-Variante
 * aus Stage C und gleichzeitig die Grundlage, die Stage E fuer echte
 * Verschachtelung ohnehin braucht.
 */

export interface IslandHitNode {
  id: string;
  /** null fuer eine Insel direkt unter dem Meer (Wurzel), sonst die ID der Eltern-Insel. */
  parentId: string | null;
  z: number;
  /** Bildschirm-Koordinaten (clientX/Y), NICHT insel-lokal. */
  containsScreenPoint(clientX: number, clientY: number): boolean;
  /**
   * Wie containsScreenPoint, aber nur fuer den "tiefen Innenbereich" (das
   * tatsaechliche Inhalts-Rechteck der Kuestenlinie, ohne den
   * KUESTENABSTAND-Rand) – Grundlage fuer Rand-Drop (Merge) vs. Mitte-Drop
   * (Kind werden) beim Drag&Drop (siehe SeaView.handleIslandDrop).
   */
  containsScreenPointInterior(clientX: number, clientY: number): boolean;
  /** Bildschirm- -> insel-lokale Weltkoordinaten; null wenn das Element gerade nicht gemessen werden kann. */
  screenToLocal(clientX: number, clientY: number): { x: number; y: number } | null;
  /** Wird vom zentralen Dispatcher (SeaView) auf dem Gewinner-Knoten aufgerufen. */
  handlePointerDown(event: PointerEvent): void;
}

/**
 * Unter den Kandidaten auf EINER Ebene gewinnt die zuletzt beruehrte
 * (hoechstes z). Gewinnt eine Insel, wird in ihre Kinder (parentId ===
 * Gewinner-ID) abgestiegen – trifft keines davon, bleibt die Insel selbst
 * der Treffer (der Punkt liegt dann in ihrem eigenen Bereich, ausserhalb
 * aller Kind-Inseln).
 */
export function resolveOwner(nodes: readonly IslandHitNode[], clientX: number, clientY: number): IslandHitNode | null {
  let parentId: string | null = null;
  let winner: IslandHitNode | null = null;

  for (;;) {
    const candidates = nodes.filter((n) => n.parentId === parentId && n.containsScreenPoint(clientX, clientY));
    if (candidates.length === 0) break;
    winner = candidates.reduce((best, n) => (n.z > best.z ? n : best));
    parentId = winner.id;
  }

  return winner;
}

/** Wie resolveOwner, aber eine Insel (z.B. die gerade gezogene) und all ihre Nachfahren ausgeschlossen. */
export function resolveOwnerExcluding(
  nodes: readonly IslandHitNode[],
  clientX: number,
  clientY: number,
  excludeId: string,
): IslandHitNode | null {
  const excluded = new Set<string>([excludeId]);
  // Mehrfacher Durchlauf, bis sich die Menge nicht mehr aendert – einfacher
  // als eine Baum-Traversierung und bei der ueblichen Insel-Anzahl (keine
  // tausenden Ebenen) performant genug.
  let grew = true;
  while (grew) {
    grew = false;
    for (const node of nodes) {
      if (node.parentId !== null && excluded.has(node.parentId) && !excluded.has(node.id)) {
        excluded.add(node.id);
        grew = true;
      }
    }
  }

  return resolveOwner(nodes.filter((n) => !excluded.has(n.id)), clientX, clientY);
}
