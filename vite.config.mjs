import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Strict CSP for the packaged app only — the dev server needs inline scripts for React Fast Refresh.
const csp = {
  name: 'prod-csp',
  transformIndexHtml: {
    order: 'pre',
    handler: (html, ctx) =>
      ctx.server
        ? html
        : html.replace(
            '<head>',
            `<head>\n    <meta http-equiv="Content-Security-Policy" content="default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data:" />`
          )
  }
}

export default defineConfig({
  plugins: [react(), csp],
  base: './', // loaded from file:// in the packaged app
  build: { outDir: 'dist', emptyOutDir: true },
  server: { port: 5173, strictPort: true }
})
