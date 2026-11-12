/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{svelte,js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        ui: {
          bg: 'var(--bg)',
          surface: 'var(--surface)',
          muted: 'var(--surface-muted)',
          raised: 'var(--surface-raised)',
          border: 'var(--border)',
          'border-strong': 'var(--border-strong)',
          text: 'var(--text)',
          strong: 'var(--text-strong)',
          mutedText: 'var(--text-muted)',
          subtle: 'var(--text-subtle)',
          accent: 'var(--accent)',
          focus: 'var(--focus)',
        },
        mac: {
          bg: '#1e1e1e',
          surface: '#252526',
          sidebar: '#181818',
          border: '#333333',
          hover: '#2d2d2d',
          accent: '#0A84FF',
          accentHover: '#0071E3',
        },
      },
      fontFamily: {
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          '"SF Pro Text"',
          '"Segoe UI"',
          'Roboto',
          'sans-serif',
        ],
        mono: [
          '"SF Mono"',
          'Menlo',
          'Monaco',
          'Consolas',
          '"Liberation Mono"',
          'monospace',
        ],
      },
    },
  },
  plugins: [],
};
