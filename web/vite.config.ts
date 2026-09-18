import { defineConfig } from "vite";

// El SDK de Stellar usa `global` en algunos módulos; en el navegador apunta a globalThis.
export default defineConfig({
  define: { global: "globalThis" },
  build: { target: "es2022", chunkSizeWarningLimit: 2500 },
});
