/**
 * Gemeinsamer Zustand der Szene, der NICHT ueber React-Props/State laeuft,
 * weil er sich waehrend einer Pan/Zoom-Geste mit bis zu 60 Hz aendert – ein
 * React-Rerender pro Frame fuer den gesamten Insel-Baum waere der sichere
 * Weg in Ruckler (gleiches Prinzip wie v1: kein setState pro Zeichenpunkt).
 *
 * Stattdessen: ein Ref mit der aktuellen Transform (Inseln lesen ihn direkt,
 * ohne Props-Durchreichung) und eine kleine Registry von "resync"-Funktionen,
 * die SeaView nach jeder Transform-Aenderung gebuendelt aufruft (ueber
 * requestAnimationFrame entprellt, siehe SeaView.tsx).
 */

import { createContext, useContext } from 'react';
import type { IslandHitNode } from './ownership';
import type { SceneTransform } from './PanZoomController';

export interface SceneContextValue {
  /** Immer der aktuelle Wert – NICHT als React-Dependency verwenden. */
  getTransform(): SceneTransform;
  /** Eine Insel meldet sich an: wird nach jeder Transform-Aenderung gerufen. */
  registerResync(id: string, resync: () => void): void;
  unregisterResync(id: string): void;
  /** Das DOM-Element, dessen Rect den sichtbaren Bildschirmbereich aufspannt. */
  getViewportElement(): HTMLElement | null;
  /**
   * Fuer die Ownership-Aufloesung bei ueberlappenden Inseln (siehe
   * scene/ownership.ts). Jede Insel meldet sich mit ihrem aktuellen
   * Kuestenlinien-Test an; SeaView ruft resolveOwner() auf dieser Liste bei
   * jedem pointerdown auf.
   */
  registerIslandHitNode(node: IslandHitNode): void;
  unregisterIslandHitNode(id: string): void;
}

const SceneContext = createContext<SceneContextValue | null>(null);

export const SceneProvider = SceneContext.Provider;

export function useScene(): SceneContextValue {
  const value = useContext(SceneContext);
  if (!value) throw new Error('useScene muss innerhalb von <SeaView> benutzt werden.');
  return value;
}
