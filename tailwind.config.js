/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        club: {
          bg: '#0f0f0f',       
          panel: '#1a1a1a',    
          accent: '#FFD400',   
          'accent-hover': '#FFC800',
        }
      }
    },
  },
  plugins: [],
}