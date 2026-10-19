/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      // ── Semantic surface colors (theme-aware via CSS vars) ──────────────────
      colors: {
        surface: {
          primary:   'var(--bg-primary)',
          secondary: 'var(--bg-secondary)',
          tertiary:  'var(--bg-tertiary)',
          sidebar:   'var(--bg-sidebar)',
        },
        edge: {
          DEFAULT: 'var(--border)',
          hover:   'var(--border-hover)',
        },
        ink: {
          DEFAULT: 'var(--text)',
          muted:   'var(--text-muted)',
        },
        brand: {
          DEFAULT: 'var(--accent)',
          glow:    'var(--accent-glow)',
        },
        // ── Status colors (same across themes) ────────────────────────────────
        success: {
          DEFAULT: '#10b981',
          subtle:  'rgba(16,185,129,0.10)',
          border:  'rgba(16,185,129,0.20)',
        },
        warning: {
          DEFAULT: '#f59e0b',
          subtle:  'rgba(245,158,11,0.10)',
          border:  'rgba(245,158,11,0.20)',
        },
        danger: {
          DEFAULT: '#ef4444',
          subtle:  'rgba(239,68,68,0.10)',
          border:  'rgba(239,68,68,0.20)',
        },
        info: {
          DEFAULT: '#06b6d4',
          subtle:  'rgba(6,182,212,0.10)',
          border:  'rgba(6,182,212,0.20)',
        },
        violet: {
          DEFAULT: '#8b5cf6',
          subtle:  'rgba(139,92,246,0.10)',
          border:  'rgba(139,92,246,0.20)',
        },
      },

      // ── App text-size additions ─────────────────────────────────────────────
      // Only adds NEW names — does not override Tailwind defaults.
      // Tailwind defaults kept as-is: xs=12px, sm=14px, base=16px, 2xl=24px …
      // Migration map for arbitrary values in the codebase:
      //   text-[10px] → text-2xs    text-[13px] → text-body
      //   text-[12px] → text-xs     text-[14px] → text-sm
      // ── One font for the whole system: Arial (the owner asked for it) ─────────
      // sans, serif and mono all map to it, so no class can bring another face back.
      fontFamily: {
        sans: ['Arial', 'Helvetica', 'sans-serif'],
        serif: ['Arial', 'Helvetica', 'sans-serif'],
        mono: ['Arial', 'Helvetica', 'sans-serif'],
      },

      fontSize: {
        '2xs':  ['10px', { lineHeight: '14px' }],
        'body': ['13px', { lineHeight: '20px' }],
      },

      // ── Border radius ───────────────────────────────────────────────────────
      borderRadius: {
        card: 'var(--radius-card)',
      },

      // ── Shadows ─────────────────────────────────────────────────────────────
      boxShadow: {
        card:     'var(--shadow-card)',
        elevated: 'var(--shadow-elevated)',
      },

      // ── Opacity scale — 4 levels, covers 90% of use cases ──────────────────
      // Use: text-white/low, text-white/mid, text-white/high (not /45, /55 etc.)
      opacity: {
        low:  '0.30',
        mid:  '0.50',
        high: '0.70',
        full: '1',
      },
    },
  },
  plugins: [],
};
