import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  base: './', // needed for file:// loading inside Electron
  plugins: [react()],
})
