import { defineConfig } from "vite";

// Relative asset paths, so the build works wherever it is mounted: the
// project-site subdirectory, a user site at the root, a custom domain, or a
// local preview. An absolute base hardcodes the repo name and breaks silently
// everywhere else. Override with BASE_PATH if an absolute base is ever needed.
export default defineConfig({
  base: process.env.BASE_PATH ?? "./",
  build: {
    outDir: "dist",
    target: "es2022",
    sourcemap: true,
  },
});
