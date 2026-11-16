import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri expects a fixed dev port.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    // Rust build output is locked while cargo writes it; watching it crashes
    // the dev server with EBUSY on Windows.
    watch: { ignored: ["**/src-tauri/**"] },
  },
  build: { target: "es2021" },
});
