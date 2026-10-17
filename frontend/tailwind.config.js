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
        // Neutral graphite surfaces (no blue cast): app bg -> cards -> raised controls -> borders.
        ink: { 950: "#141416", 900: "#1c1c1f", 850: "#212124", 800: "#27272b", 700: "#303035", 600: "#3c3c42" },
        fg: { DEFAULT: "#ececee", muted: "#a2a2a8", faint: "#818188" },
        accent: { DEFAULT: "#4c6ef5", hover: "#6380f7", soft: "#8ea2fa" },
        good: "#2fbf5b",
        warn: "#fab219",
        serious: "#ec835a",
        bad: { DEFAULT: "#e5484d", fg: "#ff7a7e", soft: "#ffb3b5" },
      },
      borderRadius: { card: "14px" },
    },
  },
  plugins: [],
};
