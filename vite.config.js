import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    lib: {
      entry: "src/page-fade.jsx",
      name: "GraffordPageFade",
      formats: ["iife"],
      /* 배포용 페이드는 js/grafford-page-fade.js (바닐라). 이 빌드는 덮어쓰지 않음 */
      fileName: () => "grafford-page-fade.react.js",
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
