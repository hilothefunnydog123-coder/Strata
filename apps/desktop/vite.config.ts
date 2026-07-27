import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Relative base + hash routing so the built bundle also loads from `file://`
// (how the Tauri webview serves `../dist` in production). Dev server runs on the
// port Tauri's `build.devUrl` points at (1420).
export default defineConfig({
  plugins: [react()],
  base: "./",
  server: { port: 1420, strictPort: true },
  clearScreen: false,
});
