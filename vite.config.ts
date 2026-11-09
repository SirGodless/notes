import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Relative base so the built bundle also works when served from a sub-path.
  base: './',
  server: {
    host: true,
    port: 5173,
    // Im Dev-Betrieb liefert Vite nur das Frontend; die Datei-API laeuft
    // separat (server/index.ts, Standardport 3000). Produktiv bedient ein
    // einziger Node-Prozess beides (siehe Dockerfile) – dort ist der Proxy
    // unnoetig, aber auch harmlos, da es dann keinen Vite-Devserver gibt.
    proxy: {
      '/api': process.env.NOTES_API_PROXY ?? 'http://localhost:3000',
    },
  },
});
