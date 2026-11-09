import { SeaView } from './scene/SeaView';

/**
 * Die Szene (das Meer mit seinen Inseln) ist der einzige Einstiegspunkt.
 * v1s Seiten-Editor (state/, components/, storage/db.ts+autosave.ts,
 * history/) ist seit Stage F (Migration + Cutover) komplett entfernt –
 * eine bestehende v1-Exportdatei laesst sich ueber den Toolbar-Button
 * "v1-Datei importieren" einlesen (siehe model/migrations.ts migrateV1ToV2).
 */
export default function App() {
  return <SeaView />;
}
