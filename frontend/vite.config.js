import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import fs from 'node:fs'
import path from 'node:path'

/**
 * Tiny Vite plugin that stamps a build timestamp into public/sw.js
 * so the service worker cache name auto-bumps on every production build.
 * No more manual version bumps.
 */
function swVersionStamp() {
  return {
    name: 'sw-version-stamp',
    writeBundle({ dir }) {
      const outDir = dir || 'dist'
      const swPath = path.resolve(outDir, 'sw.js')
      if (!fs.existsSync(swPath)) return
      const contents = fs.readFileSync(swPath, 'utf-8')
      const stamped = contents.replace('__BUILD_TS__', Date.now().toString(36))
      fs.writeFileSync(swPath, stamped)
    },
  }
}

const backendPort = process.env.VITE_BACKEND_PORT || '8122';

export default defineConfig({
  plugins: [react(), tailwindcss(), swVersionStamp()],
  server: {
    port: parseInt(process.env.VITE_PORT || '5173'),
    proxy: {
      '/api': `http://localhost:${backendPort}`,
      '/ws': { target: `ws://localhost:${backendPort}`, ws: true },
    },
  },
  build: {
    // Target modern browsers including iOS Safari 14+.
    // 'safari14' tells esbuild to downlevel any ES2022+ syntax (e.g. private
    // class fields used by Phaser 3.88) that Safari 14 doesn't support, so the
    // Phaser chunk never causes "importing module script failed" on older iPhones.
    target: ['es2020', 'safari14'],
    rollupOptions: {
      output: {
        // Isolate Phaser in its own chunk. Without this, Rollup walks Phaser's
        // entire 6 MB dependency graph while tree-shaking the rest of the app,
        // which is the main cause of slow Docker builds since Adventure Mode
        // was added. Phaser also gets cached by the browser independently so
        // returning users don't re-download it on every app update.
        manualChunks: {
          phaser: ['phaser'],
        },
      },
    },
  },
})
