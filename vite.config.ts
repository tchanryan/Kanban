import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
export default defineConfig({
  base: process.env.VITE_BASE_PATH || '/',
  plugins: [
    react(),
    {
      name: 'build-revision',
      transformIndexHtml: () => [
        {
          tag: 'meta',
          attrs: {
            name: 'app-build',
            content:
              process.env.GITHUB_SHA ||
              process.env.BUILD_REVISION ||
              'development',
          },
          injectTo: 'head',
        },
      ],
    },
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['icon.svg', 'icon-192.png', 'icon-512.png'],
      manifest: {
        name: 'Kanban Calendar',
        short_name: 'Kanban',
        description: 'Private, offline-first work planning',
        theme_color: '#101217',
        background_color: '#101217',
        display: 'standalone',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          {
            src: 'icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable',
          },
        ],
      },
      workbox: { globPatterns: ['**/*.{js,css,html,svg,png,ico}'] },
    }),
  ],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
