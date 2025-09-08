/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './App.{js,ts,jsx,tsx}',
    './components/**/*.{js,ts,jsx,tsx}',
    './services/**/*.{js,ts,jsx,tsx}',
    './modelConfigs.{js,ts}',
    './constants.{js,ts}',
    './types.{js,ts}'
  ],
  theme: { extend: {} },
  plugins: []
};
