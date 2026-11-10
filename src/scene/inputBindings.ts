/**
 * Zentrale Zuordnung von Eingabe-Ereignissen zu Aktionen – an einer Stelle,
 * damit eine spaetere Einstellungs-UI zum Anpassen der Belegungen nicht den
 * ganzen Code durchsuchen muss, nur diese Datei.
 *
 * Bewusst ein mutierbares Modul-Level-Objekt statt React-State: Bindings
 * werden nicht pro Frame gelesen oder geaendert (anders als z.B. die
 * Pan/Zoom-Transform), eine Re-Render-Kaskade waere hier unnoetig.
 */

export interface InputBindings {
  /**
   * Maustasten, die die Szene pannen statt zu zeichnen/Inhalt zu erzeugen
   * (1 = mittlere Taste, 2 = rechte Taste). JEDE einzeln reicht aus – es
   * muessen NICHT beide gleichzeitig gedrueckt sein ("oder", nicht "und":
   * ein PointerEvent hat ohnehin nur eine `button`, die genau die Taste
   * nennt, die dieses Ereignis ausgeloest hat).
   */
  panMouseButtons: number[];
}

let bindings: InputBindings = {
  panMouseButtons: [1, 2],
};

export function getInputBindings(): InputBindings {
  return bindings;
}

export function setInputBindings(patch: Partial<InputBindings>): void {
  bindings = { ...bindings, ...patch };
}

interface ButtonEvent {
  pointerType: string;
  button: number;
}

/** Maus-Pointerdown mit einer der konfigurierten Pan-Tasten. */
export function isPanTrigger(event: ButtonEvent): boolean {
  return event.pointerType === 'mouse' && bindings.panMouseButtons.includes(event.button);
}

// ---------------------------------------------------------------------------
// Touch-Tap-Erkennung (siehe SeaView.tsx): ein Touch entscheidet sich erst
// beim Loslassen, ob er ein Tipp (Inhalt erzeugen, wie ein Linksklick) oder
// ein Ziehen (Szene pannen) war – anders als bei der Maus, wo button/down
// das sofort eindeutig sagt.
// ---------------------------------------------------------------------------

/** Laenger als das gilt ein Touch nicht mehr als Tipp, sondern als (ggf. sehr langsames) Ziehen. */
export const TAP_MAX_DURATION_MS = 400;

/** Mehr Bewegung als das (in Bildschirm-Pixeln) macht aus einem Tipp ein Ziehen. */
export const TAP_MAX_MOVEMENT_PX = 12;
