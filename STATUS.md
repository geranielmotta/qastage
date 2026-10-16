# Status do QAStage

Onde o projeto parou e o que vem a seguir. (Arquitetura completa no [README](README.md).)

## Feito — F0 (contrato de plugin + esqueleto)

- Monorepo **pnpm + Turborepo** (`apps/*`, `packages/*`).
- **`@qastage/core-contract`** — o contrato: um plugin fornece um *executor*
  (`RunContext → RunResult`). Não assume Cucumber; k6 e outros entram igual.
- **`@qastage/runner`** — registro de plugins + CLI que executa um executor.
- **`@qastage/plugin-example`** — prova o contrato ponta a ponta.
- **`apps/shell`** — placeholder do host MFE (entra no F1).

Verificado de verdade:

```bash
corepack enable
pnpm install
pnpm run runner list
pnpm run runner -- run example --env qa --url https://qa.exemplo.com   # status: passed, artefato em artifacts/
pnpm build   # typecheck ok nos 4 pacotes (turbo precisa do pnpm no PATH: corepack enable)
```

## Feito — F1 (metade runner do `ui-testing`)

- **`@qastage/plugin-ui`** registrado no runner como `ui-testing` (Playwright + parser Gherkin, sem Cucumber runtime).
- **Scan** (`--mode scan --paths /a,/b`): grava `<maps>/<tela>.json` com os elementos com `data-testid`
  e lista os interativos **sem** testid, já com o testid sugerido pela convenção (slug do rótulo).
- **Cadeia de resolução** ([resolver.ts](packages/plugin-ui/src/runner/resolver.ts)):
  exceção manual do QA (`exceptions.json`, se existir é a única usada) → `data-testid` = slug →
  testid achado pelo mapa (rótulo → testid) → semântico (role/label/placeholder/texto).
  Nada achado → erro com o trecho pronto para colar no `exceptions.json`.
- **Passos de tela** (pt, [steps.ts](packages/plugin-ui/src/runner/steps.ts)): acesso, preencho, clico,
  seleciono, marco/desmarco, devo ver / não devo ver, campo deve conter, devo estar em.
- Artefatos por execução: print final/falha por cenário + `resolucoes.json` (como cada campo foi achado).
- Demo em `examples/ui-demo` (cada campo do login exercita uma estratégia da cadeia).

Gate verificado de verdade:

```bash
pnpm run ui-demo   # em outro terminal: site em http://localhost:4173
pnpm run runner -- run ui-testing --url http://localhost:4173 --mode scan --paths /login,/painel --maps examples/ui-demo/qastage/maps
pnpm run runner -- run ui-testing --url http://localhost:4173 --feature examples/ui-demo/features/login.feature --maps examples/ui-demo/qastage/maps
# 2 cenários, 16 passos passed. Sem o exceptions.json, "Entrar" falha com a instrução de fallback.
```

Parâmetros do plugin (qualquer `--opção` que o runner não conhece vira param):
`--mode run|scan`, `--paths`, `--maps` (padrão `qastage/maps`), `--browser chromium|firefox|webkit`,
`--headed true`, `--timeout ms` (padrão 5000), `--testIdAttribute`.

## Feito — F1 (metade front)

- **API HTTP do runner** ([server.ts](apps/runner/src/server.ts), porta 4000): `GET /api/plugins`,
  `POST /api/runs` (assíncrono) + `GET /api/runs/:id` (polling), `GET /api/files?path=` (só dentro do projeto).
  CLI e API usam o mesmo [execute.ts](apps/runner/src/execute.ts).
- **Contrato** ganhou `WebRemote` (no manifesto) e `PanelProps` (o que o shell passa a todo painel).
- **`apps/shell`** (React + Vite + Module Federation, porta 5173): seleção de ambiente, navegação
  e carga dos painéis **em runtime** a partir do manifesto — sem remotes fixos no build.
- **Painel do `ui-testing`** (`packages/plugin-ui/web`, remote `qastage_ui` na 5174): editor do
  `.feature` + execução, passos com status, prints, tabela "como cada campo foi encontrado";
  aba de scan com elementos com/sem testid e o testid sugerido.

Verificado de verdade (Playwright dirigindo o shell): execução PASSED e scan pelas telas,
sem erros no console; `vite build` do shell e do remote ok.

```bash
pnpm run ui-demo                              # site de demo  :4173
pnpm --filter @qastage/runner dev             # API do runner :4000
pnpm --filter @qastage/plugin-ui dev          # remote do painel :5174
pnpm --filter @qastage/shell dev              # shell :5173 → abra e vá em "Telas (UI)"
# ou, com o pnpm no PATH (corepack enable): pnpm dev  (turbo sobe runner, remote e shell)
```

## Próximo

- **Fechar o F1:** editar o `exceptions.json` pelo painel (botão "usar este seletor" no erro) e
  listar o vocabulário de passos no editor (endpoint com `listSteps()`).
- **F2 — reports & artifacts:** print por passo, relatório navegável, pacote estruturado de falha.
- Config de ambientes/projeto no runner (hoje os ambientes ficam no localStorage do shell e a pasta
  de mapas é um campo do painel).

## Decisões fixadas

- MFE: **Module Federation puro** (`@module-federation/vite`), remotes registrados em runtime.
- Nome: **QAStage**. Monorepo único. Stack: **pnpm + Turborepo**, React+TS (shell),
  Node+TS (runner).
- Começar pelas telas (UI) antes da API.
- Doc de arquitetura (Claude Doc): https://claude.ai/code/artifact/63ea3fab-05fb-4cd7-8ac4-c1dd9293e74b

## Em aberto

- SSO: captura inicial de sessão por projeto, a detalhar quando aparecer.
