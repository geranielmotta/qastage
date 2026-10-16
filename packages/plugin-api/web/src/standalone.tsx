// Roda o painel sozinho (sem shell), útil para desenvolver o plugin isolado.
import { createRoot } from "react-dom/client";
import Panel from "./Panel";

createRoot(document.getElementById("root")!).render(
  <Panel apiBase="http://localhost:4000" env={{ name: "local", baseUrl: "http://localhost:4280" }} />,
);
