import { defineConfig } from "vite";

// Caminhos relativos: o mesmo build funciona na raiz de um domínio ou numa subpasta
// (o GitHub Pages serve o projeto em /divine-landing/).
export default defineConfig({
  base: "./",
});
