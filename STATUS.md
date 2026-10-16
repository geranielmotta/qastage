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

## Feito — F5 (load-testing)

- **`@qastage/plugin-load`** (`load-testing`): o `.feature` descreve carga, mix e limites; o plugin **gera o
  script k6** (endpoints do spec + corpos do schema com valores do módulo de dados, 50 corpos por endpoint),
  roda o k6 e devolve as métricas.
  - Carga constante (`5 usuários virtuais por "1m"`) ou rampa (`a carga sobe até 20 usuários em "30s" e se
    mantém por "2m"`); tempo de espera entre requisições (padrão 1 s: carga realista, não martelada).
  - Mix ponderado: tabela `| endpoint | peso |`. Login no `setup()` do k6.
  - Limites: p95/p99 geral ou por endpoint, taxa de erro geral ou por endpoint, vazão mínima. Cada limite
    vira um passo com o valor medido; reprovado → pacote de falha (e card no Jira, se configurado).
  - Métricas no resultado e no **relatório** (nova seção "Métricas", genérica para qualquer plugin).
- **Travas de segurança:**
  - **Só em ambiente autorizado**: URL local ou ambiente listado em `QASTAGE_LOAD_ENVS` — senão recusa.
  - Teto de usuários virtuais (`QASTAGE_LOAD_MAX_VUS`, padrão 100).
  - Ambiente só-leitura (homolog) recusa endpoints de escrita no mix.
  - Segredos fora do script (vão por `-e` do k6) e fora do `summary.json` (`setup_data` removido + máscara).
- **Painel "Carga"** (remote `qastage_load` :5177) com cartões de métricas e link para o relatório.
- Demo: a API de demo ficou 1 ms mais lenta na listagem por cliente cadastrado (degradação realista);
  `carga.feature` passa e `carga-pico.feature` reprova o p95 da listagem (medido ~930 ms vs. limite 100 ms).
  **Reinicie a demo entre execuções**: os cadastros ficam em memória e deixam a listagem lenta.

Verificado: carga constante e rampa, limite reprovado, não autorizado, homolog só-leitura, teto de VUs,
k6 ausente, artefatos sem segredos, painel e relatório no navegador.

```bash
pnpm run api-demo
pnpm run runner -- run load-testing --env qa --url http://localhost:4280 --feature examples/api-demo/features/carga.feature
pnpm run runner -- run load-testing --env qa --url http://localhost:4280 --feature examples/api-demo/features/carga-pico.feature
```

## Feito — Configuração do projeto

- **`qastage.config.json`** (tipos `ProjectConfig`/`EnvConfig` no contrato): ambientes com URL do front e da
  API, `escrita` e `carga` (ambos **padrão false**), ambiente padrão e parâmetros padrão por plugin.
- Runner lê a cada execução, valida (URL, booleanos, `padrao`) e resolve o ambiente; `ResolvedEnv` ganhou
  `apiUrl` e `allowLoad`. `GET /api/config` entrega os ambientes resolvidos ao shell.
- CLI: `--env` basta (ou nada, usa o `padrao`); `--url`/`--apiUrl` sobrescrevem; erros de uso saem limpos.
- api-testing e load-testing usam a URL da API do ambiente; a carga respeita `"carga": true`
  (`QASTAGE_LOAD_ENVS` vira só fallback).
- Shell: nome do projeto, ambientes do arquivo (iguais para o time), selos escrita/só leitura/carga, ambiente
  escolhido lembrado; painéis recebem `defaults` do plugin e mostram a URL da API só leitura.
- Sem o arquivo: modo antigo intacto, com aviso no shell.

Verificado: CLI dos 3 plugins só com `--env`, carga recusada em `qa`, escrita recusada em `homolog`,
ambiente inexistente, config inválida, shell + painéis no navegador com e sem config.

## Feito — Múltiplos projetos e dashboard

- **Projetos** em `projetos/<id>/` (config + `features/ui|api|carga` + mapas) ou registrados em
  `qastage.projects.json` (projeto no repositório do próprio sistema). Config inválida isola só aquele projeto.
- **Runner**: `--project` na CLI (`run ... --project <id>`, `projects` lista); `RunContext.project` e
  `PluginApiRequest.project` no contrato; caminhos relativos resolvidos na pasta do projeto, sem escapar dela;
  histórico em `artifacts/<projeto>/<plugin>/<id>`; rotas `/api/projects` (listar com resumo, criar),
  `/api/projects/:id` (config resolvida), `/features` e `/file` (ler/gravar `.feature`).
- **Shell**: dashboard de projetos (ambientes, cenários por tipo, últimas execuções, "+ Novo projeto");
  dentro do projeto: trilha com troca de projeto, ambiente lembrado por projeto, "Visão geral" com os arquivos
  por tipo (abrem direto no painel certo).
- **Painéis**: barra de arquivos do projeto (`FeatureFiles` no web-kit: abrir, salvar, salvar como);
  relatórios filtrados pelo projeto; o rascunho de API detecta o endpoint de login do Swagger e usa
  `${QA_USUARIO}`/`${QA_SENHA}` do `.env`.
- Demos viraram dois projetos: `portal-demo` (telas) e `api-clientes` (API + carga, Swagger por URL).
- Correção: o swagger-parser recusa URL interna (proteção SSRF `safeUrlResolver`); o QAStage já baixa o spec
  e passa o documento pronto — ambientes de QA costumam estar em rede interna.

Verificado no navegador: dashboard, criação de projeto, abrir arquivo pela visão geral, executar, salvar no
disco, trocar de projeto, relatórios só do projeto; CLI por projeto, projeto inexistente, caminho fora do projeto.

## Próximo

1. **`qastage init` / gerar testes**: a partir do Swagger e de um usuário de teste, gerar os `.feature` de API
   e, com scan navegando as telas após o login, esqueletos de UI (o "Então" fica para o QA).
   Requer `${VAR}` nos passos de tela.
2. **Validar com um projeto real** da empresa (front + Swagger + Jira).
3. Matriz de navegadores na UI e captura de sessão para SSO.
4. Deploy: runner como serviço (fila, artefatos em object storage) e remotes publicados.

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
