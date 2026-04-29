/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        card: 'hsl(var(--card))',
        border: 'hsl(var(--border))',
        muted: 'hsl(var(--muted))',
        'muted-foreground': 'hsl(var(--muted-foreground))',
        primary: 'hsl(var(--primary))',
        'primary-hover': 'hsl(var(--primary-hover))',
        'primary-foreground': 'hsl(var(--primary-foreground))',
        secondary: 'hsl(var(--secondary))',
        'secondary-hover': 'hsl(var(--secondary-hover))',
        'secondary-foreground': 'hsl(var(--secondary-foreground))',
        accent: 'hsl(var(--accent))',
        destructive: 'hsl(var(--destructive))',
        success: 'hsl(var(--success))',
        warning: 'hsl(var(--warning))',
        code: 'hsl(var(--code))',
      },
      boxShadow: {
        hard: '6px 6px 0 0 var(--shadow-color)',
        'hard-sm': '4px 4px 0 0 var(--shadow-color)',
        'hard-lg': '10px 10px 0 0 var(--shadow-color)',
      },
      fontFamily: {
        head: ['"Archivo Black"', 'Impact', 'sans-serif'],
        sans: ['"DM Sans"', 'system-ui', 'sans-serif'],
        mono: ['"Space Mono"', 'ui-monospace', 'monospace'],
      },
      backgroundImage: {
        grid: 'linear-gradient(hsl(var(--border) / 0.24) 1px, transparent 1px), linear-gradient(90deg, hsl(var(--border) / 0.24) 1px, transparent 1px)',
      },
    },
  },
  plugins: [],
}
