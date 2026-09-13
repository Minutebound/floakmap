import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  // Class-based dark mode — we toggle the `dark` class on <html>
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Brand palette
        parking: '#2563eb',
        carwash: '#0891b2',
        ev:      '#16a34a',
        auto:    '#ea580c',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}

export default config
