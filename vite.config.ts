import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  // Relative paths so the build also works inside Capacitor and from any static host path.
  base: './',
  plugins: [
    react(),
    VitePWA({
      // Ask before switching to a new version (src/lib/pwa.ts), so an update never interrupts an edit.
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      workbox: {
        // The ML runtime and model are big and only needed for hold detection:
        // cache them on first use instead of precaching them for every visitor.
        globIgnores: ['**/ort*.{js,mjs}', '**/*.wasm', 'models/**'],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => /\.(onnx|wasm)$/.test(url.pathname) || /\/ort[^/]*\.m?js$/.test(url.pathname),
            handler: 'CacheFirst',
            options: { cacheName: 'ml-models', expiration: { maxEntries: 20 } },
          },
        ],
      },
      manifest: {
        name: 'Spray Wall',
        short_name: 'Spray Wall',
        description: 'Set and browse climbs on your home spray wall.',
        theme_color: '#161514',
        background_color: '#161514',
        display: 'standalone',
        orientation: 'any',
        start_url: './',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
});
