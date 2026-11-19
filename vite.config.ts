import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig(({ command }) => ({
  // GitHub Pages serves this project from /locker-manager/, while local development
  // continues to use the root URL.
  base: command === 'build' ? '/locker-manager/' : '/',
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
  },
  optimizeDeps: {
    exclude: ['@dimforge/rapier3d-compat'],
  },
  assetsInclude: ['**/*.wasm'],
}))
