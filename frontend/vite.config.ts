import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The dev server proxies /api to FastAPI so the browser never needs the API key or a CORS exception.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { "/api": { target: process.env.TOOLFENCE_API ?? "http://127.0.0.1:8000", changeOrigin: true } },
  },
});
