import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const server = process.env.HEARTH_DEV_SERVER ?? 'http://localhost:8080'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Tauri expects a fixed port and reads TAURI_* env vars.
  clearScreen: false,
  envPrefix: ['VITE_', 'TAURI_ENV_'],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/health': server,
      '/.well-known': server,
      '/api': server,
      '/gateway': { target: server.replace(/^http/, 'ws'), ws: true },
    },
  },
})
