/**
 * Datenmodell fuer v2 (unendliche Flaeche, "Inseln im Meer").
 *
 * Bewusst getrennt von types.ts: Stroke/InkLayer/StrokePoint aus v1 bleiben
 * unveraendert und werden hier nur wiederverwendet. Dieses Modul hat keine
 * DOM-Abhaengigkeit (kein window, kein document) und wird deshalb sowohl vom
 * Browser-Code als auch vom Node-Server importiert – eine einzige
 * Quelle der Wahrheit fuer das Dateiformat.
 *
 * Eine Insel ist ein Ordner (siehe server/paths.ts). Diese Datei beschreibt
 * nur den Inhalt der island.json darin, nicht die Ordnerstruktur selbst.
 */

import { createId } from './factory.ts';
import type { InkLayer, TextDoc } from './types.ts';

export const ISLAND_VERSION = 2;

export interface TextBox {
  id: string;
  /** Position relativ zur Insel, die diese Textbox enthaelt (Welteinheiten). */
  x: number;
  y: number;
  /**
   * Zielbreite in echten Zeichen (nicht CSS "ch" – das ist die Breite der
   * Ziffer "0", kein Zeichenmass). Wird im Frontend ueber TextMetrics in
   * Pixel umgerechnet. Default 66, siehe Bringhurst-Spanne 45-75.
   */
  measureChars: number;
  /** Zeilen dieser Box rasten aufs globale Grundlinienraster ein. */
  snapToBaselineGrid: boolean;
  content: TextDoc;
}

/**
 * Inhalt einer island.json. Enthaelt nur, was diese Insel DIREKT besitzt –
 * Kind-Inseln sind keine Liste hier drin, sondern der islands/-Unterordner
 * auf der Festplatte (siehe server/paths.ts, server/store.ts).
 */
export interface IslandManifest {
  version: number;
  id: string;
  name: string;
  /** Position relativ zum Elternordner. Fuer die Wurzel (das Meer) immer 0,0. */
  x: number;
  y: number;
  /**
   * Stapelreihenfolge unter Geschwistern. Bei jeder Interaktion (Zeichnen,
   * Verschieben, Text bearbeiten) auf max(Geschwister-z) + 1 gesetzt –
   * "zuletzt beruehrt liegt oben" entscheidet bei Ueberlappung, wer einen
   * neuen Strich/Text bekommt.
   */
  z: number;
  textBoxes: TextBox[];
  /** Exakt das v1-Schema: Stroke[], tool: "pen" | "eraser", ... */
  layers: InkLayer[];
  /** true nach Inhaltsaenderung – Trigger fuer Kuestenlinien-Neuberechnung. */
  coastlineDirty: boolean;
  /** true nach Inhaltsaenderung – Trigger fuer Miniatur-Neurender. */
  thumbnailStale: boolean;
  /**
   * Gesetzt bei einem Rand-Merge (diese Insel ist die Quelle, ihr Inhalt
   * wurde bereits in eine andere Insel uebernommen). Der Ordner bleibt
   * unveraendert liegen, bis der Server beim naechsten Start aufraeumt –
   * siehe server/cleanup.ts. Bis dahin ist der Merge per Undo umkehrbar.
   */
  flaggedForDeletion?: boolean;
}

export function createTextBox(params: {
  x: number;
  y: number;
  measureChars?: number;
  snapToBaselineGrid?: boolean;
  content?: TextDoc;
}): TextBox {
  return {
    id: createId(),
    x: params.x,
    y: params.y,
    measureChars: params.measureChars ?? 66,
    snapToBaselineGrid: params.snapToBaselineGrid ?? true,
    content: params.content ?? { type: 'doc', content: [{ type: 'paragraph' }] },
  };
}

export function createIslandManifest(params: {
  name: string;
  x?: number;
  y?: number;
  z?: number;
  textBoxes?: TextBox[];
  layers?: InkLayer[];
}): IslandManifest {
  return {
    version: ISLAND_VERSION,
    id: createId(),
    name: params.name,
    x: params.x ?? 0,
    y: params.y ?? 0,
    z: params.z ?? 0,
    textBoxes: params.textBoxes ?? [],
    layers: params.layers ?? [],
    coastlineDirty: true,
    thumbnailStale: true,
  };
}

/** Die Wurzel-Insel (das Meer) hat immer dieselbe ID und Position 0,0. */
export function createRootManifest(): IslandManifest {
  return { ...createIslandManifest({ name: 'Meer' }), id: 'root', x: 0, y: 0, z: 0 };
}
