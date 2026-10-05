/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['IBM Plex Sans', 'system-ui', 'sans-serif'],
        display: ['Space Grotesk', 'IBM Plex Sans', 'system-ui', 'sans-serif'],
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
      borderRadius: {
        field: '16px',   // inputs y botones (FormInput / FormBtn)
        card: '24px',    // tarjetas de contenido (StatCard)
        panel: '28px',   // paneles, modales y tablas
      },
      boxShadow: {
        card: '0 12px 24px rgba(8, 20, 27, 0.06)',
        panel: '0 14px 32px rgba(8, 20, 27, 0.06)',
        cta: '0 18px 28px rgba(8, 20, 27, 0.16)',
        sheet: '0 24px 56px rgba(3, 14, 19, 0.16)',
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
