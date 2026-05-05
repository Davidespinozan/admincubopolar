import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { sentryVitePlugin } from '@sentry/vite-plugin'

// Solo subimos source maps a Sentry cuando todo está configurado:
// AUTH_TOKEN + ORG + PROJECT presentes y mode == production. En dev/CI
// sin tokens el plugin queda inerte y el build sigue funcionando.
const sentryEnabled = Boolean(
  process.env.SENTRY_AUTH_TOKEN &&
  process.env.SENTRY_ORG &&
  process.env.SENTRY_PROJECT
)

export default defineConfig(({ mode }) => ({
  test: {
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
    },
  },
  plugins: [
    react(),
    // Sentry plugin debe ir DESPUÉS de los demás plugins de output.
    // disable=true omite la subida pero NO rompe el build.
    sentryVitePlugin({
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      authToken: process.env.SENTRY_AUTH_TOKEN,
      disable: !sentryEnabled || mode !== 'production',
      sourcemaps: {
        // Borrar source maps del bundle final tras subirlos a Sentry —
        // así no quedan accesibles en producción pero Sentry sí puede
        // mapear el stack trace al código original.
        filesToDeleteAfterUpload: ['dist/assets/**/*.map'],
      },
    }),
  ],
  build: {
    outDir: 'dist',
    // Source maps requeridos por Sentry para mapear stack traces.
    // Se generan siempre; el plugin los sube y luego los borra en prod.
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom'],
          'vendor-supabase': ['@supabase/supabase-js'],
        }
      }
    },
    // Aumentar límite de advertencia ya que exportReports es lazy loaded
    chunkSizeWarningLimit: 750,
    // Remove console.log/warn in production, keep console.error
    minify: 'esbuild',
  },
  esbuild: {
    drop: mode === 'production' ? ['debugger'] : [],
    pure: mode === 'production' ? ['console.log', 'console.warn'] : [],
  },
}))
