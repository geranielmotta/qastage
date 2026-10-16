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

## Próximo — F1 (plugin `ui-testing`)

Objetivo (gate): um `.feature` roda contra uma URL e resolve os campos sozinho.

1. `packages/plugin-ui` com as duas metades (`runner/` passos de tela + `web/` remote).
2. **Scan de `data-testid`**: crawler lê o DOM de uma tela e grava um mapa por tela.
3. **Cadeia de resolução**: `data-testid` → semântico (role/label/placeholder) →
   fallback manual do QA (nunca travar).
4. Passos de tela genéricos (ex.: `eu preencho "{campo}" com "{valor}"`,
   `eu clico em "{rotulo}"`), usando Playwright no runner.
5. Primeiro remote React no `apps/shell` (Module Federation).

## Decisões fixadas

- Nome: **QAStage**. Monorepo único. Stack: **pnpm + Turborepo**, React+TS (shell),
  Node+TS (runner).
- Começar pelas telas (UI) antes da API.
- Doc de arquitetura (Claude Doc): https://claude.ai/code/artifact/63ea3fab-05fb-4cd7-8ac4-c1dd9293e74b

## Em aberto

- Mecanismo de MFE: Module Federation puro ou shell (single-spa) — confirmar no F1.
- SSO: captura inicial de sessão por projeto, a detalhar quando aparecer.
