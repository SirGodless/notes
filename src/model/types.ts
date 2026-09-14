/**
 * Datenmodell. Alles hier ist reines JSON – strukturell klonbar (IndexedDB)
 * und ohne Verlust als Datei exportierbar.
 *
 * Koordinaten liegen immer im Page-Space (siehe config.ts: PAGE_WIDTH/HEIGHT),
 * nie in Bildschirm- oder Canvas-Pixeln. Dadurch ist eine Datei unabhaengig
 * von Zoom, Aufloesung und Geraet.
 */

/** Ein einzelner aufgezeichneter Pointer-Sample. */
export interface StrokePoint {
  x: number;
  y: number;
  /** 0..1. Bei Geraeten ohne Drucksensor konstant (siehe ink/pressure.ts). */
  pressure: number;
  /** ms seit Beginn des Strichs – nicht Wall-Clock, damit es diffbar bleibt. */
  timestamp: number;
}

export type ToolKind = 'pen' | 'eraser';

/**
 * Ein Strich. Auch der Radiergummi ist ein Strich – er wird beim Rendern nur
 * mit globalCompositeOperation "destination-out" gezeichnet.
 *
 * Das ist der Kern des Modells: die Layer-Bitmap ist jederzeit exakt aus der
 * geordneten Strich-Liste reproduzierbar. Deshalb ueberlebt pixelgenaues
 * Radieren einen Reload, ohne dass wir Bitmaps speichern muessten.
 */
export interface Stroke {
  id: string;
  points: StrokePoint[];
  /** Bei tool === 'eraser' bedeutungslos, wird aber mitgeschrieben. */
  color: string;
  /** Basisbreite in Page-Space-Pixeln; Druck moduliert sie beim Rendern. */
  width: number;
  tool: ToolKind;
}

export interface InkLayer {
  id: string;
  name: string;
  visible: boolean;
  /** Aufsteigend = weiter oben im Stapel. */
  order: number;
  strokes: Stroke[];
}

/** Tiptap-/ProseMirror-JSON. Bewusst nicht weiter typisiert. */
export type TextDoc = Record<string, unknown>;

/** Eine Seite: ein Text-Layer, darueber n Ink-Layer. */
export interface Page {
  id: string;
  text: TextDoc;
  layers: InkLayer[];
}

/** Aktuelle Formatversion. Bei jeder Modell-Aenderung hochzaehlen. */
export const CURRENT_VERSION = 1;

export interface NotesDocument {
  version: number;
  id: string;
  title: string;
  /** Seiten liegen in der Reihenfolge untereinander. */
  pages: Page[];
  /** ms seit Epoch, nur informativ. */
  updatedAt: number;
}
