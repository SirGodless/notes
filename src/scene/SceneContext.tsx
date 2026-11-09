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
 *
 * Seit Stage E (Verschachtelung) traegt der Context zusaetzlich alle
 * Insel-uebergreifenden Mutations-Callbacks (onStrokeCommitted usw.) sowie
 * `toolRef`/`router` und `getChildren` – damit IslandView sich rekursiv
 * selbst fuer seine Kind-Inseln rendern kann, ohne dass jede Verschachtelungs-
 * ebene dieselben Callbacks erneut als Props durchreichen muesste.
 */

import { createContext, useContext } from 'react';
import type { PointerRouter } from '../ink/pointerRouter';
import type { IslandManifest, TextBox } from '../model/island';
import type { Stroke, TextDoc } from '../model/types';
import type { IslandHitNode } from './ownership';
import type { SceneTransform } from './PanZoomController';
import type { SceneToolState } from './sceneToolState';

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

  /** Stabil ueber die gesamte Sitzung – jede Insel-Ebene braucht denselben Router/Werkzeug-Zustand. */
  toolRef: React.RefObject<SceneToolState>;
  router: PointerRouter;

  /** Direkte Kind-Inseln von `islandId` (Stage E: Verschachtelung). */
  getChildren(islandId: string): IslandManifest[];

  onStrokeCommitted(islandId: string, layerId: string, stroke: Stroke): void;
  onTouched(islandId: string): void;
  onCreateTextBox(islandId: string, textBox: TextBox): void;
  onTextBoxChange(islandId: string, textBoxId: string, content: TextDoc): void;
  /** Eine Insel hat ihre Miniatur neu gerendert – Flag zuruecksetzen (siehe thumbnailCache.ts). */
  onThumbnailRendered(islandId: string, dataUrl: string): void;
}

const SceneContext = createContext<SceneContextValue | null>(null);

export const SceneProvider = SceneContext.Provider;

export function useScene(): SceneContextValue {
  const value = useContext(SceneContext);
  if (!value) throw new Error('useScene muss innerhalb von <SeaView> benutzt werden.');
  return value;
}
