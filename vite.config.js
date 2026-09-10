import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig(({ mode }) => ({
  base: process.env.VITE_BASE_PATH || "/",
  plugins: [react()],
  server: { proxy: { "/api": "http://127.0.0.1:3000" } },
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, "index.html"),
        verification: resolve(import.meta.dirname, "verification.html"),
      },
    },
  },
}));
