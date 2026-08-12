import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

// Multi-page build: index.html is the real React dashboard app, everything
// else is static marketing/legal/demo HTML. Without this, `vite build` only
// emits index.html and the marketing site never makes it into dist/ -
// see vercel.json for the rewrite that puts home.html at the root domain
// instead of the dashboard app.
//
// marketing-site.html is deliberately NOT listed here - it's a per-customer
// template that scripts/generate-marketing-site.js fills in and writes out
// as marketing-site.generated.html; it's never meant to be served as-is.
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        app: resolve(__dirname, 'index.html'),
        home: resolve(__dirname, 'home.html'),
        about: resolve(__dirname, 'about.html'),
        pricing: resolve(__dirname, 'pricing.html'),
        features: resolve(__dirname, 'features.html'),
        integrations: resolve(__dirname, 'integrations.html'),
        blog: resolve(__dirname, 'blog.html'),
        changelog: resolve(__dirname, 'changelog.html'),
        contact: resolve(__dirname, 'contact.html'),
        getStarted: resolve(__dirname, 'get-started.html'),
        login: resolve(__dirname, 'login.html'),
        portal: resolve(__dirname, 'portal.html'),
        terms: resolve(__dirname, 'terms.html'),
        privacy: resolve(__dirname, 'privacy.html'),
        sableTerms: resolve(__dirname, 'sable-terms.html'),
        sablePrivacy: resolve(__dirname, 'sable-privacy.html'),
        dataRequest: resolve(__dirname, 'data-request.html'),
        voiceDemo: resolve(__dirname, 'voice-receptionist-demo.html'),
      },
    },
  },
})
