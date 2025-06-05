/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{vue,js,ts,jsx,tsx}"],
  theme: {
    fontFamily: {
      sans: ["Inter", "sans-serif"],
    },
    extend: {
      colors: {
        background: "#1E201E",
        text: "#FFFFFF",
        button: "#3C3D37",
        accent: "#e08311",
      },
    },
  },
  plugins: [],
};
