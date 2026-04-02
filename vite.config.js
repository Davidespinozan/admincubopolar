import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => ({
  test: {
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
    },
  },
  plugins: [react()],
  build: {
    outDir: 'dist',
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
