import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    rollupOptions: {
      output: {
        manualChunks: {
          // Separar React y otras dependencias core
          'vendor-react': ['react', 'react-dom'],
          // Supabase en su propio chunk
          'vendor-supabase': ['@supabase/supabase-js'],
          // DOMPurify
          'vendor-security': ['dompurify'],
        }
      }
    },
    // Aumentar límite de advertencia ya que exportReports es lazy loaded
    chunkSizeWarningLimit: 750,
  }
})
