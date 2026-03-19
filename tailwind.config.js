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
    },
  },
  plugins: [],
}
