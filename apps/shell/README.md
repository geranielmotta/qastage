# @qastage/shell

Host do micro-frontend (MFE) do QAStage — React + TS, Module Federation (`@module-federation/vite`).

O shell cuida de layout, navegação e seleção de ambiente, e carrega o painel de
cada plugin **em runtime**: lê `GET /api/plugins` no runner e, para cada
manifesto com `webRemote`, registra o remote (`registerRemotes`) e carrega o
módulo exposto (`loadRemote`). Plugin novo não exige rebuild do shell.

Todo painel recebe as mesmas props (`PanelProps` em `@qastage/core-contract`):
`apiBase` (onde está o runner) e `env` (ambiente escolhido).

O shell é cliente do runner via API HTTP — ele nunca executa Playwright.

```bash
pnpm --filter @qastage/shell dev    # http://localhost:5173
```

`VITE_QASTAGE_API` muda a URL do runner (padrão `http://localhost:4000`).
