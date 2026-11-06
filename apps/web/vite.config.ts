import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/investigations': 'http://localhost:3001',
      '/health': 'http://localhost:3001',
    },
  },
})
