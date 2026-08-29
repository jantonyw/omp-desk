import { defineConfig } from "vite";

// Tauri expects a static dev server. The frontend is plain TS with no framework.
export default defineConfig({
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
  build: {
    target: "es2021",
    outDir: "dist",
  },
});
