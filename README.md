# Notes

Ein Notiz-Editor im Browser, der getippten Text und Stift-Zeichnungen in
derselben Datei kombiniert – ohne Umschalten zwischen "Text-Modus" und
"Zeichen-Modus". Was passiert, entscheidet das Eingabegerät:

| Eingabe | Wirkung |
|---|---|
| Tastatur | geht immer in den Text, unabhängig vom Ebenen-Zustand |
| Stift (`pointerType === "pen"`) | zeichnet auf der aktiven Ink-Ebene |
| Stift-Seitentaste / Radierspitze | radiert pixelgenau |
| Finger (`pointerType === "touch"`) | scrollt – und wird ignoriert, solange der Stift arbeitet |
| Maus | setzt den Textcursor, zeichnet nur bei manuell gewähltem Werkzeug |

Alles läuft im Browser. Kein Backend, keine Datenbank, kein Konto.

## Lokal starten

```bash
npm install
npm run dev
```

Dann http://localhost:5173 öffnen. Der Dev-Server lauscht auch im Netz
(`host: true`), das Tablet im selben WLAN erreicht ihn also unter
`http://<IP-des-Rechners>:5173`.

Weitere Skripte:

```bash
npm run build      # Typprüfung + Produktions-Build nach dist/
npm run preview    # den gebauten Stand lokal ausliefern
npm run typecheck  # nur die Typprüfung
```

## Mit Docker

```bash
docker compose up --build
```

Danach läuft die App auf http://localhost:3000. Der Build ist zweistufig:
Node baut, nginx liefert das Ergebnis aus – im finalen Image steckt kein
Node und keine Quelldatei mehr.

> Hinweis: Die Docker-Dateien sind geschrieben, aber im Entwicklungscontainer
> nicht ausgeführt worden (dort lief kein Docker-Daemon). Der Produktions-Build
> selbst (`npm run build` + statisch ausgeliefert) ist getestet.

## Speichern

Zwei Wege, beide ohne Server:

- **Autosave** in die IndexedDB des Browsers, ~1,5 s nach der letzten Änderung
  und spätestens alle 10 s. Beim nächsten Öffnen ist der Stand wieder da.
  Während eines laufenden Strichs wird bewusst nicht gespeichert – dazu unten
  mehr.
- **Export/Import** als `.json` über die Toolbar (`Strg+S` exportiert direkt).
  Das ist die einzige Form, in der Notizen das Gerät verlassen.

## Dateiformat

```jsonc
{
  "version": 1,            // Für spätere Migrationen, siehe src/model/migrations.ts
  "id": "…",
  "title": "Unbenannte Notiz",
  "updatedAt": 1757808000000,
  "pages": [
    {
      "id": "…",
      "text": { /* Tiptap-/ProseMirror-JSON */ },
      "layers": [
        {
          "id": "…",
          "name": "Ebene 1",
          "visible": true,
          "order": 0,          // aufsteigend = weiter oben im Stapel
          "strokes": [
            {
              "id": "…",
              "points": [{ "x": 100, "y": 200, "pressure": 0.62, "timestamp": 0 }],
              "color": "#1a1a1a",
              "width": 3,
              "tool": "pen"    // "pen" | "eraser"
            }
          ]
        }
      ]
    }
  ]
}
```

Koordinaten liegen im **Page-Space**: A4 bei 96 dpi, also 794 × 1123 Einheiten.
Sie sind damit unabhängig von Zoom, Bildschirmgröße und Pixeldichte – eine
Datei sieht auf jedem Gerät identisch aus. `timestamp` zählt Millisekunden ab
Strichbeginn, nicht die Uhrzeit.

Beim Öffnen läuft jede Datei durch `migrateDocument()`. Fehlende oder kaputte
Felder werden repariert, eine Datei mit höherer `version` wird mit klarer
Meldung abgelehnt statt halb geladen.

## Wie es aufgebaut ist

```
src/
  config.ts          Alle Tuning-Konstanten an einer Stelle
  model/             Datentypen, Fabriken, Migrationen
  ink/               Zeichenlogik – ohne React, damit für sich testbar
    renderer.ts        Bézier-Interpolation, StrokePainter
    InkEngine.ts       Pointer -> Strich, pro Seite
    pointerRouter.ts   Palm Rejection
    pressure.ts        Druckerkennung und -kurve
    LayerSurface.ts    Canvas <-> Strichliste
  history/           Ink-Undo-Stapel + Router für Strg+Z über Text und Tinte
  storage/           IndexedDB, Autosave, Datei-Export/Import
  state/             Reducer und App-Context
  components/        Toolbar, LayerPanel, PageView, TextLayer, InkLayerCanvas
```

Der Kern liegt bewusst außerhalb von React: `ink/` und `history/` kennen weder
Komponenten noch Hooks. Die React-Schicht verdrahtet nur.

### Vier Entscheidungen, die den Rest erklären

**1. Der Radierer ist ein Strich.**
Radieren arbeitet mit `globalCompositeOperation = "destination-out"`, also
pixelgenau wie in GoodNotes und nicht strichweise wie in Samsung Notes.
Gespeichert wird trotzdem kein Bitmap, sondern ein normaler Strich mit
`tool: "eraser"`. Beim Aufbau einer Ebene wird die Strichliste der Reihe nach
abgearbeitet; Radierer-Striche wirken dabei nur auf das, was vor ihnen kam.

Das Ergebnis ist exakt reproduzierbar – nachgemessen: nach einem Reload sind es
**Pixel für Pixel dieselben** wie vor dem Reload, Abweichung 0. Ohne diesen
Trick wäre das Radierte nach jedem Neuladen wieder da, weil aus den Strichdaten
neu gerendert wird.

**2. Undo speichert Operationen, keine Bilder.**
Ein ImageData-Schnappschuss von A4 bei Renderfaktor 2 sind rund 14 MB. Bei
"vorher und nachher" pro Radier-Geste wäre der Speicher nach wenigen Aktionen
voll. Stattdessen merkt sich der Stapel nur, welcher Strich an welcher Position
dazukam; rückgängig heißt "Strich raus, Ebene neu aufbauen". Gemessen: ~165 ms
für eine Ebene mit 750 Strichen – einmalig bei einem Tastendruck, nie während
des Zeichnens.

**3. Pro neuem Punkt wird genau ein Teilstück gezeichnet.**
Der `StrokePainter` merkt sich, was er schon gemalt hat, und hängt nur das Neue
an. Dadurch ist der Aufwand pro Punkt konstant, egal wie lang der Strich ist.
Ebenso hängt `LayerSurface` einen neuen Strich an, statt die Ebene neu
aufzubauen – letzteres passiert nur nach Undo, beim Laden oder bei
Auflösungswechsel.

**4. Während eines Strichs rendert React nicht.**
Pointer-Events schreiben direkt ins Canvas; der React-State erfährt erst beim
Abheben davon. Ein `setState` pro Punkt wäre bei der Abtastrate eines aktiven
Stifts der sichere Weg in einstellige Bildraten.

### Gemessene Leistung

Chromium, Ebene mit 750 bereits vorhandenen Strichen (30.000 Punkte):

| | |
|---|---|
| Kosten pro gezeichnetem Punkt | ~0,02 ms |
| Punkte, die in ein 60-fps-Frame passen | ~800 |
| Kosten pro Punkt bei Strich Nr. 10.000 | ~0,025 ms (wächst nicht) |
| Frames > 25 ms während eines 5-Sekunden-Strichs | 0 von 325 |
| Undo (kompletter Ebenen-Neuaufbau, 750 Striche) | ~165 ms |
| Laden + Aufbau von 1500 Strichen (5,2 MB) | ~900 ms |

Ein Stift mit 240 Hz liefert vier Punkte pro Frame. Das ist etwa ein halbes
Prozent des Budgets.

### Palm Rejection

Drei Stufen, konfigurierbar in `config.ts`:

1. Solange ein Stift-Pointer unten ist, wird jede Finger-Eingabe verworfen.
2. Danach noch `PEN_IDLE_GRACE_MS` lang – voreingestellt **500 ms**, nicht die
   oft genannten 150. Beim Schreiben setzt man den Stift zwischen Buchstaben
   kurz ab, der Handballen liegt dabei weiter auf; 150 ms sind kürzer als so
   eine Pause und würden ihn durchlassen.
3. Wurde auf diesem Gerät je ein Stift benutzt, zeichnet der Finger nie mehr,
   sondern scrollt nur. Das löst den Fall, den Stufe 1 und 2 prinzipiell nicht
   können: der Ballen liegt meistens auf, *bevor* die Spitze registriert wird.

Dazu kommt ein CSS-Detail, das leicht übersehen wird: Scrollen lässt sich nur
über `touch-action` verhindern, `preventDefault()` auf `pointerdown` reicht
laut Spezifikation ausdrücklich nicht. Die Seite schaltet deshalb auf
`touch-action: none`, sobald ein Stift in der Nähe ist – der S-Pen meldet sich
beim Schweben an, also eine Frame bevor er aufsetzt. Gleichzeitig wird der
Text-Layer auf `pointer-events: none` gesetzt, was auch Chromes
Stift-Handschrifterkennung fernhält, die sonst über `contenteditable`
anspringt und aus Gekritzel Text machen will.

### Druckerkennung

Nicht jedes Gerät liefert echten Druck – manche melden konstant 0, manche
konstant 0.5, eine Maus gar nichts. Eine Probe sammelt über die Sitzung
Stichproben und entscheidet einmal. Kann das Gerät keinen Druck, wird
`pressure: 1` gespeichert, also "volle eingestellte Breite". Der erste Strich
einer frischen Installation ist deshalb gleichmäßig dick; danach steht das
Urteil und liegt in `localStorage`.

## Bewusst nicht drin (v1)

- **Tinte folgt dem Text nicht.** Verschiebt sich Text, bleibt die Tinte an
  ihrer Position. So abgesprochen.
- **Kein Seitenumbruch im Text.** Jede Seite hat ihren eigenen Text-Layer;
  Text fließt nicht auf die nächste Seite über.
- **Textmarker/Transparenz.** Das inkrementelle Zeichnen setzt Deckkraft 1
  voraus – überlappende Segmente würden sonst nachdunkeln. Bräuchte einen
  eigenen Renderpfad.
- **Ebenen anlegen/löschen ist nicht im Undo.** Nur Zeichnen und Radieren.
- **Kein Verschieben oder Auswählen von Tinte**, kein Lasso.
- **Tiptap-Editoren bleiben für alle Seiten geladen.** Nur die Canvases werden
  bei Bedarf aus- und wieder eingehängt. Bei sehr vielen Seiten lohnt es sich,
  auch die Editoren zu virtualisieren.
- **Safari ist ungetestet und kein Ziel.**

## Browser

Funktional getestet wurde gegen **Chromium** (automatisiert: Zeichnen, Radieren,
Palm Rejection, Undo über Text und Tinte, Zoom, Export/Import, Reload).

**Firefox** ließ sich in der Entwicklungsumgebung nicht installieren, konnte
also nicht durchgeklickt werden. Sämtliche benutzten APIs sind dort aber seit
Firefox 59 verfügbar (Android: 79) – geprüft gegen die MDN-Kompatibilitätsdaten:

| API | Firefox | Chrome |
|---|---|---|
| `PointerEvent.getCoalescedEvents()` | 59 | 58 |
| `PointerEvent.pressure` / `.pointerType` | 59 | 55 |
| `Element.setPointerCapture()` | 59 | 55 |
| `touch-action` | 52 | 36 |
| `crypto.randomUUID()` | 95 | 92 |
| `IntersectionObserver` | 55 | 51 |

Es gibt also keinen bekannten Grund, warum es unter Firefox nicht laufen sollte –
verifiziert ist es dort aber nicht.

**Safari** ist weder getestet noch Ziel.

## Tastenkürzel

| | |
|---|---|
| `Strg+Z` | rückgängig – Text oder Tinte, je nachdem was zuletzt dran war |
| `Strg+Umschalt+Z` / `Strg+Y` | wiederherstellen |
| `Strg+S` | als `.json` exportieren |

## Speicherbedarf

Ein Ebenen-Canvas kostet bei A4 und Renderfaktor 2 rund **14 MB**. Deshalb
bekommen nur Seiten in Blicknähe überhaupt ein Canvas
(`PAGE_MOUNT_MARGIN_PX`), und ab `SOFT_LAYER_LIMIT` Ebenen weist das Panel
darauf hin. Ohne diese Begrenzung bräuchte ein 20-Seiten-Dokument mit drei
Ebenen über 800 MB.

## Stack

React 19, TypeScript, Vite 8, Tiptap 3 (`@tiptap/react`, `@tiptap/starter-kit`).
Keine State-Management-Bibliothek, kein Design-System, keine Canvas-Bibliothek.
