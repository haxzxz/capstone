import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Keep local API calls same-origin in the browser while forwarding them to FastAPI during development.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, open: true, proxy: { '/api': 'http://127.0.0.1:8000' } },
})
