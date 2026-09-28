/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: ['./src/**/*.{astro,html,js,ts,jsx,tsx,md,mdx}','../landing-site-astro/src/app/**/*.{tsx,ts}'],
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#eef6fb',
          100: '#dbeaf4',
          200: '#b8d5ea',
          300: '#87ceeb',
          400: '#61b8df',
          500: '#2c8ec0',
          600: '#0c5d8c',
          700: '#003153',
          800: '#022844',
          900: '#041d31'
        },
        sky: {
          50: '#f2fbff',
          100: '#d7f4fd',
          200: '#b8ebfa',
          300: '#87ceeb',
          400: '#5ab6dd',
          500: '#3898c4',
          600: '#287598',
          700: '#225f7c',
          800: '#204f66',
          900: '#1f4357'
        },
        amber: {
          50: '#fff8e7',
          100: '#ffefc2',
          200: '#ffdf85',
          300: '#ffcf47',
          400: '#ffbf00',
          500: '#e2a800',
          600: '#b8860b',
          700: '#8d680f',
          800: '#755512',
          900: '#634813'
        },
        success: '#52c41a',
        warning: '#faad14',
        error: '#ff4d4f',
        info: '#1890ff'
      },
      fontFamily: {
        sans: ['"Noto Sans SC"', '"Segoe UI"', '-apple-system', 'sans-serif'],
        serif: ['"Source Han Serif SC"', '"Noto Serif SC"', 'serif']
      },
      boxShadow: {
        brand: '0 24px 80px rgba(0, 49, 83, 0.14)',
        card: '0 12px 36px rgba(0, 49, 83, 0.10)',
        soft: '0 8px 20px rgba(0, 49, 83, 0.08)'
      },
      backgroundImage: {
        'brand-radial': 'radial-gradient(circle at top, rgba(135, 206, 235, 0.22), transparent 44%)',
        'brand-grid': 'linear-gradient(rgba(0, 49, 83, 0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(0, 49, 83, 0.08) 1px, transparent 1px)'
      }
    }
  },
  plugins: [require('@tailwindcss/typography')],
};
