/**
 * Zentrale Tuning-Konstanten.
 *
 * Alles, was man beim Benutzen der App irgendwann mal anders haben will,
 * steht hier – damit man nicht durch den ganzen Code grepen muss.
 */

// ---------------------------------------------------------------------------
// Seitenformat
// ---------------------------------------------------------------------------

/**
 * DIN A4 bei 96 dpi (dem CSS-Referenz-DPI): 210mm x 297mm.
 * 210 / 25.4 * 96 = 793.7  ->  794
 * 297 / 25.4 * 96 = 1122.5 -> 1123
 *
 * Alle Stroke-Koordinaten werden in diesem Raum gespeichert ("Page-Space"),
 * unabhaengig von Zoom und Bildschirmaufloesung. Damit bleibt eine gespeicherte
 * Datei auf jedem Geraet identisch.
 */
export const PAGE_WIDTH = 794;
export const PAGE_HEIGHT = 1123;

/**
 * Luecke zwischen zwei aus einer migrierten v1-Datei entstandenen Inseln
 * (siehe model/migrations.ts: migrateV1ToV2) – dieselbe vertikale Stapelung
 * wie v1s Seiten, nur mit etwas Platz dazwischen statt nahtlos aneinander.
 */
export const V1_MIGRATION_PAGE_GAP = 80;

// ---------------------------------------------------------------------------
// Canvas-Aufloesung
// ---------------------------------------------------------------------------

/**
 * Faktor, mit dem das Canvas intern hoeher aufgeloest gerendert wird als es
 * bei Zoom 100% dargestellt wird.
 *
 * Entscheidung: mindestens 2 (Vorgabe), nach oben auf 3 gedeckelt.
 * Begruendung: Speicher waechst quadratisch. Bei A4 und Faktor 2 kostet ein
 * Layer 794*2 * 1123*2 * 4 Byte ~ 14 MB. Faktor 3 waeren schon ~32 MB.
 * Ueber 3 lohnt sich der Unterschied optisch nicht mehr gegen die Kosten.
 */
export const MIN_RENDER_SCALE = 2;
export const MAX_RENDER_SCALE = 3;

export function getRenderScale(): number {
  const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
  return Math.min(MAX_RENDER_SCALE, Math.max(MIN_RENDER_SCALE, Math.round(dpr)));
}

// ---------------------------------------------------------------------------
// Zoom
// ---------------------------------------------------------------------------

export const MIN_ZOOM = 0.35;
export const MAX_ZOOM = 2.5;

// ---------------------------------------------------------------------------
// Palm Rejection
// ---------------------------------------------------------------------------

/**
 * Zeitfenster nach dem letzten Stift-Event, in dem Finger-Eingaben verworfen
 * werden.
 *
 * Entscheidung: 500ms statt der oft genannten 150ms. Grund: beim Schreiben
 * setzt man den Stift kurz ab (Buchstabenabstand, neues Wort), der Handballen
 * liegt dabei aber weiter auf. 150ms sind kuerzer als eine normale Schreibpause
 * und wuerden den Ballen durchlassen.
 */
export const PEN_IDLE_GRACE_MS = 500;

/**
 * Sobald auf diesem Geraet einmal ein Stift benutzt wurde, zeichnet Finger-
 * Eingabe grundsaetzlich nicht mehr, sondern scrollt nur noch.
 *
 * Das loest den Fall, den ein reines Nachlauf-Fenster nicht loesen kann: der
 * Handballen liegt meistens *bevor* die Stiftspitze registriert wird auf dem
 * Display – zu dem Zeitpunkt gab es noch gar kein Pen-Event zum Blockieren.
 */
export const STICKY_PEN_MODE = true;

// ---------------------------------------------------------------------------
// Strichdarstellung
// ---------------------------------------------------------------------------

/** Strichstaerken-Presets der Toolbar, in Page-Space-Pixeln. */
export const PEN_WIDTHS = [1, 2, 3, 5, 8, 12];
export const ERASER_WIDTHS = [8, 16, 32, 64];

export const DEFAULT_PEN_WIDTH = 3;
export const DEFAULT_ERASER_WIDTH = 16;

export const PEN_COLORS = [
  '#1a1a1a',
  '#c0392b',
  '#1f6feb',
  '#1e8e3e',
  '#e8a33d',
  '#7d3c98',
];

/**
 * Druck -> Strichbreite. Bei Druck 0 bleiben MIN_PRESSURE_WIDTH_RATIO der
 * eingestellten Breite uebrig, bei Druck 1 die volle Breite.
 * 0.35 gibt sichtbare Dynamik, ohne dass leichte Striche verschwinden.
 */
export const MIN_PRESSURE_WIDTH_RATIO = 0.35;

/**
 * Glaettung des Druckwerts ueber die Zeit (exponentieller gleitender
 * Mittelwert). 0 = keine Glaettung, 1 = eingefroren. Rohe Druckwerte
 * zappeln sonst und der Strich bekommt sichtbare Dellen.
 */
export const PRESSURE_SMOOTHING = 0.5;

/**
 * Punkte, die naeher als das am Vorgaenger liegen, werden verworfen.
 * Spart Datenmenge und Rechenzeit, ohne dass man es sieht.
 */
export const MIN_POINT_DISTANCE = 0.6;

// ---------------------------------------------------------------------------
// Stift-Tasten
// ---------------------------------------------------------------------------

/**
 * Ein Stift mit Radierspitze meldet beim Umdrehen Bit 5 in `buttons` (Wert 32).
 * Der S-Pen hat keine Radierspitze, aber eine Seitentaste (Bit 1, Wert 2) –
 * die ist der naheliegende Radierer-Shortcut.
 */
export const ERASER_BUTTON_MASK = 32;
export const BARREL_BUTTON_MASK = 2;
export const BARREL_BUTTON_ERASES = true;

// ---------------------------------------------------------------------------
// Kuestenlinie (v2, Stage C)
// ---------------------------------------------------------------------------

/**
 * Abstand der Kuestenlinie vom Inhalt, in Welteinheiten. Zwei Inhaltsklumpen
 * verschmelzen zu einer Landmasse, sobald sie sich auf weniger als 2x diesen
 * Wert naehern – das ist beabsichtigt (siehe Plan: "Verschmelzen passiert
 * nur innerhalb einer Insel").
 */
export const KUESTENABSTAND = 24;

/**
 * Rastergroesse fuer die Distanztransformation, in Welteinheiten pro Zelle.
 * Kleiner = praeziserer Kuestenverlauf, aber mehr Rechenaufwand (O(Zellen)).
 * 8 ist fein genug, dass die Kontur bei normaler Zoomstufe glatt wirkt.
 */
export const GRID_CELL_SIZE = 8;
