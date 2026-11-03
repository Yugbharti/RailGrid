import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Design tokens from agent.md section 9.2
        ink: '#0B1220',       // bg dark
        paper: '#F5F0E6',     // bg light
        amber: '#FFB400',     // signal amber
        'rail-blue': '#1F4FFF',
        'signal-green': '#2FBF71',
        'signal-red': '#E5484D',
        chalk: '#E8ECF4',     // chalk text
        steel: '#8A94A8',     // steel muted
      },
      fontFamily: {
        display: ['Barlow Condensed', 'system-ui', 'sans-serif'],
        ui: ['Instrument Sans', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'monospace'],
      },
      borderRadius: {
        sm: '2px',
        DEFAULT: '4px',
        md: '6px',
      },
      animation: {
        'flap-in': 'flap-in 0.15s ease-in-out',
        'flap-out': 'flap-out 0.15s ease-in-out',
      },
      keyframes: {
        'flap-in': {
          '0%': { transform: 'rotateX(-90deg)', opacity: '0' },
          '100%': { transform: 'rotateX(0deg)', opacity: '1' },
        },
        'flap-out': {
          '0%': { transform: 'rotateX(0deg)', opacity: '1' },
          '100%': { transform: 'rotateX(90deg)', opacity: '0' },
        },
      },
    },
  },
  plugins: [],
};

export default config;
