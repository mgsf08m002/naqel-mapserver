/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './templates/**/*.html',
    './auth/templates/**/*.html',
    './notifications/templates/**/*.html',
    './config/templates/**/*.html',
    './**/*.html',
    './**/*.py',
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}

