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
          hover: 'var(--surface-hover)',
          border: 'var(--border)',
          'border-strong': 'var(--border-strong)',
          'border-subtle': 'var(--border-subtle)',
          text: 'var(--text)',
          strong: 'var(--text-strong)',
          mutedText: 'var(--text-muted)',
          subtle: 'var(--text-subtle)',
          accent: 'var(--accent)',
          'accent-strong': 'var(--accent-strong)',
          focus: 'var(--focus)',
          danger: 'var(--danger)',
          success: 'var(--success)',
          warning: 'var(--warning)',
        },
      },
      fontFamily: {
        sans: [
          'Inter',
          '-apple-system',
          'BlinkMacSystemFont',
          '"SF Pro Text"',
          '"Segoe UI"',
          'Roboto',
          'sans-serif',
        ],
        mono: [
          '"JetBrains Mono"',
          '"SF Mono"',
          'Menlo',
          'Monaco',
          'Consolas',
          '"Liberation Mono"',
          'monospace',
        ],
      },
      fontSize: {
        '2xs': ['10px', '13px'],
        xs: ['11px', '15px'],
        sm: ['12px', '16px'],
        base: ['13px', '18px'],
      },
    },
  },
  plugins: [],
};
