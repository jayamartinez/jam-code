import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { readFileSync } from 'node:fs';

/** The app's version, shown in Settings → About. */
const { version } = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
) as {
  version: string;
};

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: { 'import.meta.env.VITE_JAM_VERSION': JSON.stringify(version) },
  clearScreen: false,
  server: {
    host: '127.0.0.1',
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ['**/src-tauri/**', '**/target/**'],
      // Windows formatters can briefly truncate a file before writing its contents.
      awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 25 },
    },
  },
  build: { target: 'es2022' },
});
