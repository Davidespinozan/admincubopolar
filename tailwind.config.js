/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        display: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
      },
      // Tanda 18 P2: breakpoint xs para distinguir celulares chicos
      // (iPhone SE/mini ≈360px) de los grandes (iPhone Pro Max ≈430px).
      // Útil para layouts que pueden apretar texto/iconos en pantalla
      // chica pero respirar en grande sin necesidad de saltar a sm (640px).
      screens: {
        xs: '475px',
      },
      // Fase A (convergencia visual por rol): jerarquía de radios y sombras
      // del shell de Administración, con nombre, para que las vistas por rol
      // usen el mismo lenguaje sin repetir valores arbitrarios.
      // Sistema "CUBOPOLAR 2026" (docs/sistema/diseno.md): campo 14, tarjeta 20, hoja 28.
      borderRadius: {
        field: '14px',   // inputs y botones (FormInput / FormBtn)
        card: '20px',    // tarjetas de contenido
        panel: '28px',   // hojas, modales y tablas
      },
      boxShadow: {
        card: '0 1px 2px rgba(11, 18, 32, 0.04), 0 10px 28px -14px rgba(11, 18, 32, 0.14)',
        panel: '0 1px 2px rgba(11, 18, 32, 0.04), 0 10px 28px -14px rgba(11, 18, 32, 0.14)',
        cta: '0 10px 24px -10px rgba(11, 18, 32, 0.45)',
        sheet: '0 -8px 40px rgba(11, 18, 32, 0.14)',
        pop: '0 18px 48px -12px rgba(11, 18, 32, 0.28)',
      },
      colors: {
        ink: '#0b1220',
        canvas: '#f4f6f9',
        line: '#e6eaf0',
        accent: { DEFAULT: '#0e7490', soft: '#e6f3f6' },
        brand: { a: '#0b1f3a', b: '#0f172a' },
      },
      // Padding utilities para safe-area-inset (notch / home indicator
      // de iPhone). Tanda 18 P2. Permiten escribir `pt-safe-t`, `pb-safe-b`
      // en lugar de `style={{ paddingTop: 'env(...)' }}` cuando NO se
      // necesita el `max(env, fallback)` que ya usa CuboPolarERP/ChoferView.
      padding: {
        'safe-t': 'env(safe-area-inset-top)',
        'safe-b': 'env(safe-area-inset-bottom)',
        'safe-l': 'env(safe-area-inset-left)',
        'safe-r': 'env(safe-area-inset-right)',
      },
    },
  },
  plugins: [],
}
