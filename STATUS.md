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
- **Rotas HTTP de plugin** (`RunnerPlugin.routes`, montadas em `/api/plugins/<nome>/...`). O ui-testing
  expõe `GET /steps` (vocabulário, clicável no editor) e `GET|PUT /exceptions`.
- **Exceção manual pelo painel:** quando um rótulo não resolve, o passo traz `details` estruturado e o
  painel mostra um formulário (css/testid/texto/xpath, tela ou todas) que grava no `exceptions.json` e
  reexecuta. Pasta de mapas restrita ao projeto.

Verificado de verdade (Playwright dirigindo o shell): execução PASSED e scan pelas telas,
sem erros no console; `vite build` do shell e do remote ok.

```bash
pnpm run ui-demo                              # site de demo  :4173
pnpm --filter @qastage/runner dev             # API do runner :4000
pnpm --filter @qastage/plugin-ui dev          # remote do painel :5174
pnpm --filter @qastage/shell dev              # shell :5173 → abra e vá em "Telas (UI)"
# ou, com o pnpm no PATH (corepack enable): pnpm dev  (turbo sobe runner, remote e shell)
```

## Feito — F2 (reports & artifacts)

- **`@qastage/reports`**: o runner chama `writeReport` ao fim de **toda** execução, de qualquer plugin.
  Grava na pasta da execução `report.json`, `report.html` (estático, autocontido, links relativos) e um
  **pacote por falha** em `falhas/NN-cenario/` (`falha.json` + `falha.md`).
- **Pacote de falha** (`FailureReport` no contrato): cenário, passo, erro, URL da tela, roteiro de
  reprodução, dados usados, console/rede do alvo (erros JS, 4xx/5xx), print, HTML da tela e trace do Playwright.
- **ui-testing**: print a cada passo (documentação viva; `--screenshots failure` para só na falha),
  trace só quando falha (`--trace off` desliga), uma pasta por cenário.
- **Segredos mascarados**: campos tipo senha/token viram `••••••` no relatório, no pacote, nos nomes de
  passo e de arquivo. **Exceção: o `trace.zip` ainda contém o valor digitado.**
- **reports é um plugin sem executor** (`createExecutor` virou opcional): rota `GET /api/plugins/reports/runs`
  e painel **Relatórios** (remote `qastage_reports` na 5175) com histórico, link para o relatório e o pacote.
  Entrou no shell sem mudar nada no shell.
- Runner serve `artifacts/` como site estático em `/artifacts/...`; o painel de UI linka "Abrir relatório completo".

Gate verificado: `examples/ui-demo/features/falha.feature` falha e gera o pacote completo (com o 404
de `/api/notificacoes` da demo no console); no navegador, relatório com 9/9 imagens e histórico ok.

```bash
pnpm run runner -- run ui-testing --url http://localhost:4173 --feature examples/ui-demo/features/falha.feature --maps examples/ui-demo/qastage/maps
# → artifacts/ui-testing/<id>/report.html e falhas/01-painel-mostra-o-saldo/falha.md
pnpm --filter @qastage/reports dev     # painel Relatórios :5175 (junto com runner, plugin-ui e shell)
```

## Feito — F3 (integrations/jira)

- **Gancho `onRunFinished`** no contrato: todo plugin pode reagir ao fim de qualquer execução (já com o
  relatório gravado). Roda em segundo plano, nunca atrasa nem derruba a execução; a CLI aguarda antes de sair.
- **`@qastage/integrations`** (plugin sem executor): um card por falha, a partir do pacote do F2.
  - **Cloud** (API v3, descrição em ADF, e-mail + API token) e **Server/DC** (API v2, wiki markup, PAT).
    Detecta pelo domínio `*.atlassian.net` ou `QASTAGE_JIRA_FLAVOR`.
  - **Dedupe:** fingerprint = plugin + cenário + passo + erro normalizado (números, ids e query strings
    neutralizados), gravado como label `qastage-<fp>`. Card aberto → comentário; card fechado → card novo.
  - **Anexos:** print da falha + `falha.md`. O `trace.zip` **não** é anexado por padrão
    (`QASTAGE_JIRA_ATTACH_TRACE=true` libera), porque contém valores digitados.
  - **Opcional e resiliente:** sem config não faz nada; timeout de 10 s e 2 novas tentativas em
    rede/429/5xx; Jira fora → só um aviso no log. `QASTAGE_JIRA_ENVS` limita os ambientes.
  - `falhas/NN/jira.json` guarda o card; o painel **Relatórios** mostra o link e se foi criado ou comentado.
  - `GET /api/plugins/integrations/status?check=true` mostra a config (sem segredos) e testa as credenciais.
- Config por `.env` na raiz (ignorado pelo git; modelo em [.env.example](.env.example)), carregado pela CLI e pela API.
- **Jira de mentira** para desenvolver: `pnpm run jira-fake` (porta 4180, v2 e v3, `/_issues`, `/_down`).

Verificado contra o fake: criação (Cloud e Server), comentário na repetição, card novo após fechar,
Jira fora (execução segue, aviso no log), ambiente fora da lista, sem config (silencioso), e pela API
HTTP + painel Relatórios com o link do card. **Não testado contra um Jira real.**

```bash
pnpm run jira-fake     # e no .env: as variáveis do bloco "Desenvolvimento local" do .env.example
pnpm run runner -- run ui-testing --url http://localhost:4173 --feature examples/ui-demo/features/falha.feature --maps examples/ui-demo/qastage/maps
curl -s localhost:4180/_issues   # card criado, labels, anexos
```

## Feito — F4 (api-testing)

- **`@qastage/plugin-api`** (`api-testing`): fonte de endpoints como adapter — **OpenAPI 3**, **Swagger 2**
  (JSON/YAML, link ou arquivo, `$ref` resolvido) e **Postman** v2 (`:id` → `{id}`, corpo de exemplo vira schema).
  Tudo vira um modelo único de endpoint; sem LLM.
- **Corpo gerado** pelo schema (required, enum, formatos, min/max, allOf, readOnly fora) com **valores do
  módulo de dados** pelo nome do campo. Tabela `| campo | valor |` sobrescreve; `--seed` reproduz os dados.
- **Contrato**: resposta validada com ajv contra o schema do status (exato → 4XX → default; status não
  documentado = quebra de contrato). Dialeto OpenAPI (`nullable`, `readOnly`...) convertido antes.
- **Negativos em lote**: "os campos obrigatórios de X devem ser exigidos" e "os tipos dos campos de X devem
  ser validados" — uma variação por campo, exige 4xx, lista o que passou.
- **Auth**: login por passo (tabela, token extraído da resposta) ou token direto; `${VAR}` lê do `.env`
  (segredos fora do .feature); `{{var}}` usa valores guardados entre passos.
- **Ambiente só-leitura respeitado**: em `homolog` (`writable: false`) POST/PUT/PATCH/DELETE são bloqueados
  (login liberado).
- Artefatos: cada requisição/resposta em JSON por passo (Authorization e segredos mascarados); pacote de
  falha com o roteiro e o log das chamadas. Collection sem schema → passo de contrato fica "pulado", não trava.
- **Painel "APIs"** (remote `qastage_api` :5176): carrega a fonte, lista endpoints, "+ cenário"/"+ negativos"
  montam o Gherkin, executa e mostra cada troca HTTP. URL da API por ambiente.
- Novos pacotes de base: **`@qastage/data`** (CPF/CNPJ/CEP/celular/nome/e-mail válidos, semente, campo
  sensível), **`@qastage/feature`** (parser Gherkin + vocabulário, agora usado por UI e API) e
  **`@qastage/web-kit`** (cliente do runner para os painéis).
- Demo: `pnpm run api-demo` (:4280) com **2 bugs plantados** — `cep` obrigatório não validado e `telefone`
  numérico fora do contrato; `falhas.feature` acha os dois.

Verificado: `clientes.feature` passa (5 cenários), `falhas.feature` acusa os 2 bugs, homolog bloqueia escrita,
segredos mascarados nos artefatos, testes unitários (data 4/4, api 5/5: OpenAPI, Swagger 2 YAML, Postman,
nullable) e o painel no shell.

```bash
pnpm run api-demo
pnpm run runner -- run api-testing --env qa --url http://localhost:4280 --feature examples/api-demo/features/clientes.feature
pnpm run runner -- run api-testing --env qa --url http://localhost:4280 --feature examples/api-demo/features/falhas.feature
```

## Próximo

- **F5 — load-testing (k6):** script gerado dos endpoints + dados, roda o k6, métricas no reports;
  só em ambiente autorizado, com thresholds.
- **Config de projeto no runner** (pendência que já incomoda): ambientes com `baseUrl` (front) e `apiUrl`,
  `writable`, fonte de endpoints e pasta de mapas — hoje estão espalhados entre localStorage e campos dos painéis.
- Validar a integração com o Jira real; comentar "voltou a passar" no card.

## Futuro (documentado, não planejado)

- **IA assistiva opcional** — seção "IA assistiva (versão futura)" do [README](README.md). A empresa usa o
  GitHub Copilot; o provável é GitHub Models ou Azure OpenAI. Nada no caminho crítico depende de IA.

## Decisões fixadas

- MFE: **Module Federation puro** (`@module-federation/vite`), remotes registrados em runtime.
- Nome: **QAStage**. Monorepo único. Stack: **pnpm + Turborepo**, React+TS (shell),
  Node+TS (runner).
- Começar pelas telas (UI) antes da API.
- Doc de arquitetura (Claude Doc): https://claude.ai/code/artifact/63ea3fab-05fb-4cd7-8ac4-c1dd9293e74b

## Em aberto

- SSO: captura inicial de sessão por projeto, a detalhar quando aparecer.
