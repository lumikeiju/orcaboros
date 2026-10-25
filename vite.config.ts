import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig(({ command }) => ({
  base: command === "build" ? "/orcaboros/" : "/",
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 1100
  },
  optimizeDeps: {
    exclude: ["maplibre-gl"]
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.{test,spec}.{ts,tsx}"],
    coverage: {
      reporter: ["text", "html"]
    }
  }
}));
