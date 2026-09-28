/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{astro,html,js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#e9f3f9',
          100: '#d1e5f2',
          200: '#9ec2db',
          300: '#6a9fbe',
          400: '#3c779a',
          500: '#235f84',
          600: '#124b70',
          700: '#003153',
          800: '#032845',
          900: '#021c31',
        },
        sky: {
          50: '#eef9fd',
          100: '#d6f0fa',
          200: '#b4e3f6',
          300: '#87ceeb',
          400: '#59bcde',
          500: '#3094b8',
          600: '#24778f',
          700: '#1f6173',
          800: '#1d505f',
          900: '#1d434f',
        },
        amber: {
          50: '#fff8e6',
          100: '#ffefbf',
          200: '#ffdf80',
          300: '#ffcf40',
          400: '#ffc71a',
          500: '#ffbf00',
          600: '#d69f00',
          700: '#a67800',
          800: '#755400',
          900: '#4a3500',
        },
      },
      fontFamily: {
        sans: ['"Noto Sans SC"', 'Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        serif: ['"Source Han Serif SC"', 'serif'],
      },
      boxShadow: {
        soft: '0 16px 40px rgba(0, 49, 83, 0.10)',
        card: '0 20px 60px rgba(3, 20, 37, 0.08)',
        brand: '0 32px 100px rgba(3, 20, 37, 0.12)',
      },
    },
  },
  plugins: [],
};
