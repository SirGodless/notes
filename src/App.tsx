import { SeaView } from './scene/SeaView';

/**
 * Ab v2 (Stage B) ist die Szene (das Meer mit seinen Inseln) der
 * Haupteinstiegspunkt. v1s Seiten-Editor (state/AppState.tsx,
 * components/EditorContainer.tsx etc.) bleibt im Repo als Referenz liegen,
 * bis Stage F (Migration + Cutover) die alten Dateien entfernt – bis dahin
 * ist er ueber App.tsx nicht mehr erreichbar.
 */
export default function App() {
  return <SeaView />;
}
