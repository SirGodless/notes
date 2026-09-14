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

/** Innenabstand des Text-Layers zum Seitenrand, in Page-Space-Pixeln (~2cm). */
export const PAGE_PADDING = 76;

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
export const ZOOM_STEP = 0.1;

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
// Undo / Redo
// ---------------------------------------------------------------------------

/** Maximale Anzahl Eintraege im Ink-Undo-Stack. */
export const MAX_UNDO_DEPTH = 200;

/**
 * ProseMirror fasst Tastatureingaben innerhalb dieses Fensters zu einem
 * Undo-Schritt zusammen (Default der History-Extension). Der gemeinsame
 * Undo-Router muss dieselbe Gruppierung nachbilden, sonst zaehlt er mehr
 * Text-Schritte als Tiptap tatsaechlich rueckgaengig machen kann.
 */
export const TEXT_HISTORY_GROUP_MS = 500;

// ---------------------------------------------------------------------------
// Speichern
// ---------------------------------------------------------------------------

/** Wartezeit nach der letzten Aenderung, bevor in IndexedDB geschrieben wird. */
export const AUTOSAVE_DEBOUNCE_MS = 1500;

/** Obergrenze: spaetestens so oft wird gespeichert, auch bei Dauergekritzel. */
export const AUTOSAVE_MAX_INTERVAL_MS = 10_000;

// ---------------------------------------------------------------------------
// Performance
// ---------------------------------------------------------------------------

/**
 * Seiten ausserhalb des Viewports bekommen kein Canvas zugewiesen, sondern
 * erst wenn sie sich bis auf diesen Abstand genaehert haben. Ohne das kostet
 * ein 20-Seiten-Dokument mit 3 Layern ueber 800 MB Canvas-Speicher.
 */
export const PAGE_MOUNT_MARGIN_PX = 1200;

/**
 * Weiche Obergrenze fuer Ink-Layer pro Seite. Kein hartes Limit, nur ein
 * Hinweis in der UI – jeder Layer kostet oben genannte ~14 MB pro Seite.
 */
export const SOFT_LAYER_LIMIT = 8;

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
