import { AppProvider } from './state/AppState';
import { EditorContainer } from './components/EditorContainer';
import { LayerPanel } from './components/LayerPanel';
import { Toolbar } from './components/Toolbar';

export default function App() {
  return (
    <AppProvider>
      <div className="app">
        <Toolbar />
        <div className="app-body">
          <EditorContainer />
          <LayerPanel />
        </div>
      </div>
    </AppProvider>
  );
}
