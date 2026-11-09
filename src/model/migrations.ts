import { CURRENT_VERSION, type NotesDocument } from './types';
import { createDocument, createEmptyTextDoc, createId } from './factory';
import { createIslandManifest, createTextBox, type IslandManifest } from './island';

/**
 * Migrationskette.
 *
 * Aktuell gibt es nur Version 1, also keine Migration. Das Geruest steht
 * trotzdem, damit eine spaetere Modell-Aenderung nur einen Eintrag hier
 * braucht und alte Dateien nicht kaputtgehen.
 *
 * Konvention: migrations[n] hebt ein Dokument von Version n auf n+1.
 */
type Migration = (doc: any) => any;

const migrations: Record<number, Migration> = {
  // 1: (doc) => ({ ...doc, version: 2, /* neues Feld */ }),
};

export class UnsupportedVersionError extends Error {
  constructor(version: number) {
    super(
      `Dateiversion ${version} ist neuer als diese App (${CURRENT_VERSION}). ` +
        `Bitte die App aktualisieren.`,
    );
    this.name = 'UnsupportedVersionError';
  }
}

/**
 * Hebt ein rohes, moeglicherweise altes Dokument auf CURRENT_VERSION.
 * Wirft bei zu neuen Dateien – lieber ein klarer Fehler als stiller Datenverlust.
 */
export function migrateDocument(raw: unknown): NotesDocument {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('Datei enthaelt kein Dokument-Objekt.');
  }

  let doc = raw as any;
  const version = typeof doc.version === 'number' ? doc.version : 1;

  if (version > CURRENT_VERSION) throw new UnsupportedVersionError(version);

  for (let v = version; v < CURRENT_VERSION; v++) {
    const step = migrations[v];
    if (!step) throw new Error(`Keine Migration von Version ${v} auf ${v + 1}.`);
    doc = step(doc);
  }

  return normalize(doc);
}

/**
 * Repariert fehlende oder kaputte Felder, damit ein von Hand editiertes bzw.
 * teilweise beschaedigtes JSON die App nicht zum Absturz bringt.
 */
function normalize(doc: any): NotesDocument {
  const fallback = createDocument();

  const pages = Array.isArray(doc.pages) && doc.pages.length > 0 ? doc.pages : fallback.pages;

  return {
    version: CURRENT_VERSION,
    id: typeof doc.id === 'string' ? doc.id : createId(),
    title: typeof doc.title === 'string' ? doc.title : 'Unbenannte Notiz',
    updatedAt: typeof doc.updatedAt === 'number' ? doc.updatedAt : Date.now(),
    pages: pages.map((page: any, pageIndex: number) => ({
      id: typeof page?.id === 'string' ? page.id : createId(),
      text: page?.text && typeof page.text === 'object' ? page.text : createEmptyTextDoc(),
      layers: normalizeLayers(page?.layers, pageIndex),
    })),
  };
}

function normalizeLayers(layers: any, pageIndex: number) {
  if (!Array.isArray(layers) || layers.length === 0) {
    return [{ id: createId(), name: 'Ebene 1', visible: true, order: 0, strokes: [] }];
  }

  return layers
    .map((layer: any, index: number) => ({
      id: typeof layer?.id === 'string' ? layer.id : createId(),
      name: typeof layer?.name === 'string' ? layer.name : `Ebene ${index + 1}`,
      visible: layer?.visible !== false,
      order: typeof layer?.order === 'number' ? layer.order : index,
      strokes: Array.isArray(layer?.strokes) ? layer.strokes.filter(isValidStroke) : [],
    }))
    .sort((a, b) => a.order - b.order)
    // order neu vergeben, damit Luecken und Duplikate verschwinden
    .map((layer, index) => ({ ...layer, order: index }))
    .map((layer) => ({ ...layer, name: layer.name || `Ebene ${pageIndex + 1}` }));
}

function isValidStroke(stroke: any): boolean {
  return (
    stroke &&
    typeof stroke.id === 'string' &&
    Array.isArray(stroke.points) &&
    stroke.points.length > 0 &&
    typeof stroke.width === 'number' &&
    (stroke.tool === 'pen' || stroke.tool === 'eraser')
  );
}

// ---------------------------------------------------------------------------
// v1 -> v2 (Stage F): aus einem einzelnen v1-Dokument werden mehrere
// Top-Level-Inseln im v2-Arbeitsbereich (siehe Plan, Abschnitt "Migration
// von v1"). Bewusst eine reine Funktion ohne Netzwerkzugriff – das WEGSCHREIBEN
// der entstandenen Inseln (putIsland pro Insel) ist Aufgabe des Aufrufers
// (siehe scene/SeaView.tsx importV1File), damit diese Funktion isoliert
// testbar bleibt und nicht wissen muss, WIE/WOHIN gespeichert wird.
//
// pageHeight/pageGap kommen als Parameter statt aus config.ts importiert zu
// werden: dieses Modul (wie model/island.ts) hat bewusst KEINE Abhaengigkeit,
// die DOM-Globals beruehrt (config.ts' getRenderScale() liest `window`) –
// server/tsconfig.json prueft model/**/*.ts naemlich mit, und ein Import aus
// config.ts wuerde dessen DOM-freien lib-Scope ("ES2022" ohne "DOM")
// verletzen. Der Aufrufer (SeaView.tsx, reines Frontend) importiert
// PAGE_HEIGHT/V1_MIGRATION_PAGE_GAP ganz normal aus config.ts.
//
// Jede v1-Page wird eine eigene Insel: ihr `text`-Feld wird zu GENAU EINER
// TextBox mit snapToBaselineGrid=false (damit eine bestehende Notiz nicht
// ungefragt neu umbricht – das globale Grundlinienraster ist eine v2-Neuheit,
// keine rueckwirkende Anforderung an migrierte Inhalte), `layers` wird 1:1
// uebernommen (identisches Schema, siehe model/types.ts). Die Inseln werden
// vertikal gestapelt (x=0, y=pageIndex*(pageHeight+pageGap)) – dieselbe
// Lesereihenfolge wie v1s Seiten-untereinander-Ansicht.
// ---------------------------------------------------------------------------

/**
 * Wandelt ein (ggf. altes/rohes) v1-Dokument in eine Liste von v2-Insel-
 * Manifesten um. Laeuft zuerst durch migrateDocument(), damit auch eine
 * Datei aus einer noch frueheren v1-Unterversion funktioniert – dieselbe
 * Garantie, die v1s eigener Datei-Import schon hatte (siehe
 * storage/fileIO.ts importDocumentFromFile).
 */
export function migrateV1ToV2(raw: unknown, pageHeight: number, pageGap: number): IslandManifest[] {
  const doc = migrateDocument(raw);

  return doc.pages.map((page, pageIndex) => {
    const pageLabel = doc.pages.length > 1 ? `${doc.title} (${pageIndex + 1}/${doc.pages.length})` : doc.title;

    return createIslandManifest({
      name: pageLabel,
      x: 0,
      y: pageIndex * (pageHeight + pageGap),
      textBoxes: [
        createTextBox({
          x: 0,
          y: 0,
          snapToBaselineGrid: false,
          content: page.text,
        }),
      ],
      layers: page.layers,
    });
  });
}
