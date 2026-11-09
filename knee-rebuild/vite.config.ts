import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { defineConfig } from 'vitest/config'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // 'prompt' rather than 'autoUpdate': a deploy landing mid-set must never reload the page.
      registerType: 'prompt',
      // globPatterns below already precaches every icon in public/ and the plugin adds the manifest;
      // listing them again here put each in the precache twice (PWA audit, docs/pwa-audit.md).
      includeManifestIcons: false,
      manifest: {
        // The installed app's identity, stated: '/' is the id Chromium already took from start_url, so
        // nothing installed changes, and a later start_url can't fork the home-screen app (PWA audit, finding 8).
        id: '/',
        name: 'Knee Rebuild',
        short_name: 'Knee',
        description: 'What to do today, what happened, what the knee said, what comes next.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#001A57',
        theme_color: '#001A57',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Offline-first: everything the shell needs is precached on first visit, fonts included.
        globPatterns: ['**/*.{js,css,html,woff2,png,svg,ico}'],
        navigateFallback: '/index.html',
        // The Strava function's redirects are page loads: the service worker must let them reach the server.
        navigateFallbackDenylist: [/^\/api\//],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'api/**/*.test.ts', 'scripts/**/*.test.ts'],
    // The guards (src/rules/guard.test.ts, src/db/dumbbellMax.guard.test.ts) glob the sources; a
    // cached transform keeps the old list, so a file added since the last run would pass them.
    fsModuleCache: false,
  },
})
