const c = (name) => `rgb(var(--c-${name}) / <alpha-value>)`;
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        bg: c('bg'), surface: c('surface'), sunken: c('sunken'), ink: c('ink'), muted: c('muted'),
        line: c('line'), accent: c('accent'), 'accent-ink': c('accent-ink'),
        crit: c('crit'), high: c('high'), med: c('med'), low: c('low'), ok: c('ok'), warn: c('warn'),
      },
      fontFamily: { sans: ['"Schibsted Grotesk"', 'ui-sans-serif', 'system-ui', 'sans-serif'] },
      borderRadius: { DEFAULT: '6px', lg: '10px' },
      fontSize: { xs: ['12px', '16px'], sm: ['13.5px', '20px'], base: ['15px', '24px'] },
    },
  },
  plugins: [],
};
