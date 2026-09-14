/**
 * Globaler "der Nutzer zeichnet gerade"-Zaehler.
 *
 * Hintergrund: Autosave serialisiert das gesamte Dokument in die IndexedDB.
 * Bei einem vollen Notizbuch sind das mehrere Megabyte, und das Klonen dafuer
 * laeuft im Hauptthread. Faellt das mitten in einen Strich, blockiert es einen
 * Frame spuerbar – gemessen bis zu 200 ms, also ein sichtbarer Hänger unter
 * dem Stift.
 *
 * Deshalb meldet die Zeichen-Engine hier an und ab, und der Autosave wartet,
 * bis die Hand wieder oben ist. Ein paar hundert Millisekunden spaeter
 * gespeichert ist voellig unkritisch; ein stockender Strich nicht.
 */
let activeGestures = 0;

export function beginInputGesture(): void {
  activeGestures++;
}

export function endInputGesture(): void {
  activeGestures = Math.max(0, activeGestures - 1);
}

export function isInputActive(): boolean {
  return activeGestures > 0;
}
