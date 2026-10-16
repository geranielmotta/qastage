import { federation } from "@module-federation/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Host do MFE. Não declara remotes aqui: eles vêm do runner (GET /api/plugins)
// e são registrados em runtime — plugin novo não exige rebuild do shell.
export default defineConfig({
  plugins: [
    react(),
    federation({
      name: "qastage_shell",
      remotes: {},
      shared: {
        react: { singleton: true },
        "react-dom": { singleton: true },
      },
    }),
  ],
  server: { port: 5173, strictPort: true, origin: "http://localhost:5173" },
  build: { target: "esnext" },
});
