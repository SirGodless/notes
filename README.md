# Notes

Eine Insel-im-Meer-Notizfläche im Browser: jede Datei in einem Arbeitsbereich
ist eine frei positionierte, organisch umrandete Insel auf einer unendlichen
2D-Fläche ("das Meer") – alle gleichzeitig sichtbar und bearbeitbar, ohne
zwischen Dateien zu wechseln. Jede Insel kombiniert getippten Text und
Stift-Zeichnungen in derselben Fläche, ohne Umschalten zwischen
"Text-Modus" und "Zeichen-Modus". Was eine Berührung bewirkt, entscheidet
das Eingabegerät:

| Eingabe | Wirkung |
|---|---|
| Tastatur | geht immer in die zuletzt fokussierte Textbox |
| Stift (`pointerType === "pen"`) | zeichnet auf der aktiven Ink-Ebene |
| Stift-Seitentaste / Radierspitze | radiert pixelgenau |
| Finger (`pointerType === "touch"`) | pannt die Szene – und wird ignoriert, solange der Stift arbeitet |
| Maus | setzt den Textcursor bzw. erzeugt eine Textbox; zeichnet nur bei manuell gewähltem Werkzeug |

Ein kleiner Node-Dienst liefert sowohl die App als auch die Datei-API; jede
Insel ist ein echter Ordner im Arbeitsbereich, kein Browser-Speicher.

## Lokal starten

```bash
npm install
npm run dev          # Frontend (Vite), Port 5173
npm run server:dev    # Datei-API, Port 3000, Arbeitsbereich unter ./data-dev
```

Beide müssen parallel laufen – Vite proxied `/api/*` im Dev-Betrieb an den
Server (siehe `vite.config.ts`). Dann http://localhost:5173 öffnen.

Weitere Skripte:

```bash
npm run build             # Typprüfung + Produktions-Build nach dist/
npm run preview           # den gebauten Stand lokal ausliefern
npm run typecheck         # Typprüfung Frontend
npm run typecheck:server  # Typprüfung Server
npm run server             # Datei-API ohne --watch, Arbeitsbereich unter ./data
```

## Mit Docker

```bash
docker compose up --build
```

Danach läuft die App auf http://localhost:3000. Ein einziger Node-Prozess
liefert sowohl die gebauten statischen Dateien als auch die Datei-API – kein
nginx mehr nötig, da derselbe Prozess beides bedient. `docker-compose.yml`
mountet den Arbeitsbereich nach `./data`, damit er den Container überlebt.

## Arbeitsbereich & Speichern

Kein Autosave in den Browser, keine Downloads – jede Insel wird laufend
(debounced, ETag-geprüft) an die Datei-API geschrieben. Der Arbeitsbereich
ist ein echtes Ordner-Verzeichnis:

```
data/
  island.json                 ← Wurzel ("das Meer")
  islands/
    <uuid>/
      island.json              ← eigene Position, Textboxen, Ink-Ebenen
      islands/                 ← Kind-Inseln (Verschachtelung)
        <uuid>/
          island.json
```

Der `islands/`-Unterordner *ist* die Kind-Liste – es gibt kein separates
Index-Feld dafür. Schreiben läuft über `If-Match`/ETag: hat sich eine Insel
seit dem letzten Lesen anderswo geändert (z. B. zweites Gerät), schlägt der
Schreibvorgang mit `409` fehl statt die fremde Änderung still zu
überschreiben.

Eine Insel, die per Rand-Drop in eine andere verschmolzen wurde, wird nicht
sofort gelöscht, sondern nur `flaggedForDeletion: true` markiert – das macht
`Strg+Z` direkt nach dem Merge zuverlässig rückgängig. Aufgeräumt wird beim
nächsten Serverstart.

## Dateiformat (`island.json`)

```jsonc
{
  "version": 2,
  "id": "…",
  "name": "Insel 1",
  "x": 0, "y": 0,          // Position relativ zum Elternordner (0,0 für die Wurzel)
  "z": 0,                   // Stapelreihenfolge unter Geschwistern – zuletzt beruehrt liegt oben
  "textBoxes": [
    {
      "id": "…",
      "x": 0, "y": 0,
      "measureChars": 66,          // Zielbreite in echten Zeichen (siehe scene/textMetrics.ts)
      "snapToBaselineGrid": true,  // false bei aus v1 migriertem Inhalt
      "content": { /* Tiptap-/ProseMirror-JSON */ }
    }
  ],
  "layers": [
    {
      "id": "…",
      "name": "Ebene 1",
      "visible": true,
      "order": 0,
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
  ],
  "coastlineDirty": false,
  "thumbnailStale": false,
  "flaggedForDeletion": false
}
```

Koordinaten liegen im **Welteinheiten**-Raum: 1 Welteinheit = 1 CSS-Pixel bei
Zoom 1, unabhängig von Bildschirmgröße und Pixeldichte. `timestamp` zählt
Millisekunden ab Strichbeginn, nicht die Uhrzeit.

### v1-Dateien importieren

Eine aus der alten Einzeldokument-Version exportierte `.json`-Datei lässt
sich über den Toolbar-Button **"v1-Datei importieren"** einlesen
(`model/migrations.ts`, `migrateV1ToV2`). Jede Seite des alten Dokuments wird
eine eigene Top-Level-Insel, vertikal gestapelt; ihr Text wird zu einer
einzelnen Textbox mit `snapToBaselineGrid: false` (damit bestehender Inhalt
nicht ungefragt neu umbricht), die Ink-Ebenen werden unverändert übernommen.
Die Datei läuft vorher durch dieselbe Reparatur-Migration wie v1s eigener
Import (`migrateDocument`), eine unvollständige oder aus einer noch
früheren v1-Unterversion stammende Datei funktioniert also genauso.

## Wie es aufgebaut ist

```
server/              Datei-API (node:http, kein Framework), laeuft ohne Build-Schritt
src/
  config.ts             Alle Tuning-Konstanten an einer Stelle
  model/                Datentypen (geteilt mit dem Server), Fabriken, Migrationen
    island.ts             IslandManifest/TextBox – DOM-frei, auch vom Server importiert
    migrations.ts         v1-Reparatur-Migration + migrateV1ToV2
  ink/                  Zeichenlogik – ohne React, damit fuer sich testbar
    renderer.ts            Bezier-Interpolation, StrokePainter
    pointerRouter.ts       Palm Rejection
    pressure.ts            Druckerkennung und -kurve
    geometry.ts            Vektor-Helfer, Bounding-Boxes
  scene/                Die Szene: Meer, Inseln, Kacheln, Kuestenlinie, Drag&Drop
    SeaView.tsx            Oberste Komponente: Pan/Zoom, Laden/Speichern, Drag&Drop, Undo
    IslandView.tsx         Eine Insel (rekursiv fuer Kind-Inseln), Kacheln, Textboxen, Miniatur
    TileGrid.ts             Kachel-Raster pro Ink-Ebene (ersetzt v1s Ein-Canvas-pro-Ebene)
    coastline.ts            Distanztransformation + Marching Squares -> Kuestenlinie
    ownership.ts            Wer bekommt einen Strich/Drop bei ueberlappenden Inseln
    thumbnailCache.ts       Miniatur-Rendering fuer weit herausgezoomte Inseln
    textMetrics.ts          Canvas-measureText-basierte Zeichenbreite (nicht CSS "ch")
    baselineGrid.ts         Globales Grundlinienraster mit Sprungregel
  storage/              HTTP-Client fuer die Datei-API, v1-Datei-Import
  hooks/                useNearViewport (Kacheln nur in Blicknaehe)
```

Der Kern liegt bewusst außerhalb von React: `ink/` kennt weder Komponenten
noch Hooks, `model/island.ts` kennt kein DOM (deshalb vom Server direkt
importierbar). Die React-Schicht in `scene/` verdrahtet nur.

### Fünf Entscheidungen, die den Rest erklären

**1. Der Radierer ist ein Strich.**
Radieren arbeitet mit `globalCompositeOperation = "destination-out"`, also
pixelgenau wie in GoodNotes und nicht strichweise wie in Samsung Notes.
Gespeichert wird trotzdem kein Bitmap, sondern ein normaler Strich mit
`tool: "eraser"`. Beim Aufbau einer Kachel wird die Strichliste der Reihe
nach abgearbeitet; Radierer-Striche wirken dabei nur auf das, was vor ihnen
kam. Das Ergebnis ist exakt reproduzierbar – nach einem Reload sind es
Pixel für Pixel dieselben wie vorher.

**2. Kacheln statt eines Canvas pro Ebene.**
Eine Insel ist ein potenziell unendliches Dokument; ein einzelnes Canvas in
A4-Größe (v1s Ansatz) würde dafür nicht reichen. Stattdessen bekommt nur der
sichtbare Ausschnitt Kacheln (512×512 Welteinheiten), zugeordnet über das
Hüllrechteck jedes Strichs. Der Speicherbedarf hängt dadurch an der
Bildschirmfläche, nicht am Inhalt.

**3. Die Küstenlinie ist der Besitz-Test, nicht nur Optik.**
Bei überlappenden Inseln entscheidet nicht die rechteckige Bounding-Box,
sondern die tatsächliche (distanztransformierte, per Marching Squares
konturierte) Kontur, wer einen Strich/eine Textbox/einen Drop bekommt. Eine
brandneue, noch leere Insel fällt auf ihre volle Rechteckfläche zurück –
sonst könnte sie nie ihren ersten Inhalt bekommen.

**4. Rand-Drop (Merge) vs. Mitte-Drop (Kind werden) unterscheiden sich an
derselben Kontur.** "Mitte" ist der tatsächliche Inhaltsbereich (vor der
Kontur-Aufblähung um `KUESTENABSTAND`), "Rand" der aufgeblähte Saum
drumherum – fällt ein Drop in den Saum, wird verschmolzen (Inhalt
umgerechnet, Quelle nur geflaggt); fällt er auf echten Inhalt, wird die
Insel ein Kind (reines `mv`, Inhalt unverändert).

**5. Während eines Strichs/Pans rendert React nicht.**
Pointer-Events schreiben direkt ins Canvas bzw. in Inline-Styles (Pan/Zoom,
Insel-Drag); der React-State erfährt erst beim Loslassen davon. Ein
`setState` pro Punkt oder pro Pan-Frame wäre der sichere Weg in einstellige
Bildraten.

### Palm Rejection

Drei Stufen, konfigurierbar in `config.ts`:

1. Solange ein Stift-Pointer unten ist, wird jede Finger-Eingabe verworfen.
2. Danach noch `PEN_IDLE_GRACE_MS` lang – voreingestellt **500 ms**, nicht die
   oft genannten 150. Beim Schreiben setzt man den Stift zwischen Buchstaben
   kurz ab, der Handballen liegt dabei weiter auf; 150 ms sind kürzer als so
   eine Pause und würden ihn durchlassen.
3. Wurde auf diesem Gerät je ein Stift benutzt, zeichnet der Finger nie mehr,
   sondern pannt nur. Das löst den Fall, den Stufe 1 und 2 prinzipiell nicht
   können: der Ballen liegt meistens auf, *bevor* die Spitze registriert wird.

Dazu kommt ein CSS-Detail, das leicht übersehen wird: Scrollen/Pannen lässt
sich nur über `touch-action` verhindern, `preventDefault()` auf
`pointerdown` reicht laut Spezifikation ausdrücklich nicht. Jede Insel steht
deshalb dauerhaft auf `touch-action: none`.

### Druckerkennung

Nicht jedes Gerät liefert echten Druck – manche melden konstant 0, manche
konstant 0.5, eine Maus gar nichts. Eine Probe sammelt über die Sitzung
Stichproben und entscheidet einmal. Kann das Gerät keinen Druck, wird
`pressure: 1` gespeichert, also "volle eingestellte Breite".

## Bewusst nicht drin

- **Bilder/PDFs auf Inseln.** Würden Nachladen brauchen, widerspricht
  "alles sofort geladen".
- **Mehrbenutzer-Echtzeit-Zusammenarbeit.** Die ETag-Konfliktlösung ist für
  einen Nutzer mit zwei Geräten gedacht, nicht für gleichzeitiges Bearbeiten.
- **Drehen von Inseln, Lasso-Gruppierung.**
- **Rekursive Miniaturen.** Die Vorschau einer weit herausgezoomten Insel
  zeigt nur ihren eigenen Inhalt, nicht den ihrer Kind-Inseln.
- **Textmarker/Transparenz.** Das inkrementelle Zeichnen setzt Deckkraft 1
  voraus – überlappende Segmente würden sonst nachdunkeln.
- **Ink-/Text-Undo (Strg+Z zeichnet/tippt nicht zurück).** Der aktuelle
  Undo-Stack deckt nur Insel-Layout und Merge ab (siehe SeaView.tsx); Tiptaps
  eigenes Undo deckt Textänderungen *innerhalb* einer Textbox weiterhin ab.
- **Safari ist ungetestet und kein Ziel.**

## Browser

Funktional getestet wurde gegen **Chromium** (automatisiert: Zeichnen,
Radieren, Palm Rejection, Textboxen, Verschachtelung, Drag&Drop/Merge,
Undo, Zoom inkl. Miniatur-Umschaltung, v1-Import, Reload) – jeweils gegen
einen echten laufenden Server, nicht gemockt.

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
verifiziert ist es dort aber nicht. **Safari** ist weder getestet noch Ziel.
Firefox unterstützt außerdem kein `showDirectoryPicker` (File System Access
API) – einer der Gründe, warum v2 ein echtes Backend statt reinem
Browser-Speicher nutzt.

## Tastenkürzel

| | |
|---|---|
| `Strg+Z` | letzte Insel-Verschiebung oder -Verschmelzung rückgängig (deaktiviert, solange eine Textbox fokussiert ist – dort hat Tiptaps eigenes Undo Vorrang) |

## Stack

React 19, TypeScript, Vite 8, Tiptap 3 (`@tiptap/react`, `@tiptap/starter-kit`),
Node 22 (natives TypeScript-Ausführen ohne Build-Schritt für den Server,
`node:http` ohne Framework). Keine State-Management-Bibliothek, kein
Design-System, keine Canvas-Bibliothek, keine Datenbank.
