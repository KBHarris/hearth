import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'

const preview = JSON.parse(readFileSync(new URL('../desktop/src-tauri/tauri.test.conf.json', import.meta.url), 'utf8'))

const server = process.env.HEARTH_DEV_SERVER ?? 'http://localhost:8080'
const port = Number(process.env.HEARTH_DEV_CLIENT_PORT ?? 5173)
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('HEARTH_DEV_CLIENT_PORT must be a TCP port')

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: { __HEARTH_CLIENT_VERSION__: JSON.stringify(preview.version) },
  // Tauri expects a fixed port and reads TAURI_* env vars.
  clearScreen: false,
  envPrefix: ['VITE_', 'TAURI_ENV_'],
  build: process.env.HEARTH_PHASE1_HARNESS === '1' ? {rollupOptions:{input:{main:fileURLToPath(new URL('./index.html',import.meta.url)),phase1:fileURLToPath(new URL('./phase1.html',import.meta.url))}}} : undefined,
  server: {
    port,
    strictPort: true,
    proxy: {
      '/health': server,
      '/.well-known': server,
      '/api': server,
      '/gateway': { target: server.replace(/^http/, 'ws'), ws: true },
    },
  },
})
