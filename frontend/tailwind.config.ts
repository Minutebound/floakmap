import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
    // lib/ matters: theme.ts holds the semantic surface tokens, and Tailwind
    // only emits classes it has literally seen. Leaving this out silently
    // dropped `bg-ink-850` — the dark panel background — so every rail stayed
    // white in dark mode while the text went light. Nothing errors; the class
    // simply never exists.
    './src/lib/**/*.{js,ts,jsx,tsx,mdx}',
    './src/hooks/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  // Class-based dark mode — we toggle the `dark` class on <html>
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        /**
         * Two colours carry the product: ink for every surface and every piece
         * of text, signal for the one thing that wants attention. The ink ramp
         * is mixed from #0f141a rather than a neutral grey, so light mode reads
         * as the same family as dark mode instead of a separate design.
         */
        ink: {
          50:  '#f5f6f8',
          100: '#e4e7ec',
          200: '#c8cfd8',
          300: '#9aa6b4',
          400: '#6e7d8e',
          500: '#4c5a6a',
          600: '#374350',
          700: '#293440',
          800: '#1a222c',
          850: '#151c24',
          900: '#0f141a',
          950: '#0a0e12',
          DEFAULT: '#0f141a',
        },
        signal: {
          50:  '#fff1f1',
          100: '#ffdede',
          200: '#ffc2c2',
          300: '#ff9d9d',
          400: '#ff7676',
          500: '#ff5555',
          600: '#ed3535',
          700: '#c72424',
          800: '#a41f1f',
          900: '#7d1a1a',
          DEFAULT: '#ff5555',
        },
        // Category hues stay distinct: they encode which dataset a dot belongs
        // to, which is information, not decoration.
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