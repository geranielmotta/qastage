import { federation } from "@module-federation/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

// Metade front do módulo de reports: o painel de histórico de execuções.
// O shell descobre este remoteEntry pelo manifesto do plugin (webRemote).
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [
    react(),
    federation({
      name: "qastage_reports",
      filename: "remoteEntry.js",
      exposes: { "./Panel": "./src/Panel.tsx" },
      // Sem type federation: os tipos compartilhados vêm de @qastage/core-contract.
      // (O gerador de tipos também escrevia .d.ts dentro de src/.)
      dts: false,
      shared: {
        react: { singleton: true },
        "react-dom": { singleton: true },
      },
    }),
  ],
  server: { port: 5175, strictPort: true, origin: "http://localhost:5175", cors: true },
  build: { target: "esnext", outDir: "../dist/web", emptyOutDir: true },
});
