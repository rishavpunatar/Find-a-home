import forms from '@tailwindcss/forms'

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#1f2937',
        mist: '#f4f7fb',
        surge: '#0f766e',
        ember: '#dc2626',
      },
      boxShadow: {
        panel: '0 10px 40px -20px rgba(15, 118, 110, 0.35)',
      },
    },
  },
  plugins: [forms],
}
