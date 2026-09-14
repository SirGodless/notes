import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Relative base so the built bundle also works when served from a sub-path.
  base: './',
  server: {
    host: true,
    port: 5173,
  },
});
