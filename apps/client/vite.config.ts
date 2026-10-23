import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'

const preview = JSON.parse(readFileSync(new URL('../desktop/src-tauri/tauri.test.conf.json', import.meta.url), 'utf8'))

const server = process.env.HEARTH_DEV_SERVER ?? 'http://localhost:8080'
const port = Number(process.env.HEARTH_DEV_CLIENT_PORT ?? 5173)
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('HEARTH_DEV_CLIENT_PORT must be a TCP port')
const phase1Harness = process.env.HEARTH_PHASE1_HARNESS === '1'
const callHarness = process.env.HEARTH_DIRECT_CALL_HARNESS === '1'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(),{name:'acceptance-provider-probe',generateBundle(){if(callHarness)this.emitFile({type:'asset',fileName:'provider-probe.js',source:readFileSync(new URL('./test/fixtures/provider-probe.js',import.meta.url),'utf8')})}}],
  define: { __HEARTH_CLIENT_VERSION__: JSON.stringify(preview.version), __HEARTH_CALL_ACCEPTANCE__: callHarness },
  // Tauri expects a fixed port and reads TAURI_* env vars.
  clearScreen: false,
  envPrefix: ['VITE_', 'TAURI_ENV_'],
  build: phase1Harness || callHarness ? {rollupOptions:{input:{main:fileURLToPath(new URL('./index.html',import.meta.url)),...(phase1Harness?{phase1:fileURLToPath(new URL('./phase1.html',import.meta.url))}:{}),...(callHarness?{calls:fileURLToPath(new URL('./media-test.html',import.meta.url)),endpoint:fileURLToPath(new URL('./sfu-endpoint.html',import.meta.url))}:{})}}} : undefined,
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
