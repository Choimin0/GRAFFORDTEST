import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    lib: {
      entry: "src/page-fade.jsx",
      name: "GraffordPageFade",
      formats: ["iife"],
      fileName: () => "grafford-page-fade.js",
    },
    outDir: "js",
    emptyOutDir: false,
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
        assetFileNames: "grafford-page-fade[extname]",
      },
    },
  },
});
