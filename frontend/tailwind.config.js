/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "SFMono-Regular", "Consolas", "monospace"],
      },
      colors: {
        ink: { 950: "#0a0c0f", 900: "#0f1216", 850: "#13171c", 800: "#181d23", 700: "#232a32", 600: "#2f3842" },
        fg: { DEFAULT: "#e7eaee", muted: "#a3acb7", faint: "#76808c" },
        good: "#2fbf5b",
        warn: "#fab219",
        bad: "#e5484d",
        accent: "#5b9cf2",
      },
    },
  },
  plugins: [],
};
