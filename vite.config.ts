import { defineConfig } from "vite";

// Served from https://<user>.github.io/sleeper_analytics/, so assets need the
// repo name as base. Override with BASE_PATH for a custom domain or local dev.
export default defineConfig({
  base: process.env.BASE_PATH ?? "/sleeper_analytics/",
  build: {
    outDir: "dist",
    target: "es2022",
    sourcemap: true,
  },
});
