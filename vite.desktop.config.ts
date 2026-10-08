import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
const source = (path: string) =>
  fileURLToPath(new URL(`./src/${path}`, import.meta.url));
export default defineConfig({
  base: './',
  plugins: [
    react(),
    {
      name: 'desktop-storage-boundary',
      enforce: 'pre',
      resolveId(id) {
        if (id.endsWith('/app/services'))
          return source('platform/desktop/services.ts');
        if (id.endsWith('/services/drafts'))
          return source('platform/desktop/drafts.ts');
        if (id === 'virtual:pwa-register/react')
          return source('platform/desktop/noServiceWorker.ts');
        return null;
      },
      transform(_code, id) {
        if (
          /[/\\](db|platform[/\\]web)[/\\]/.test(id) ||
          /[/\\]node_modules[/\\]dexie[/\\]/.test(id)
        )
          throw Error(`Browser storage reached the desktop build: ${id}`);
        return null;
      },
    },
  ],
  build: { outDir: 'dist-desktop' },
});
