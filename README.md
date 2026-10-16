# QAStage

> Plataforma de testes de QA: o QA escreve arquivos `.feature` e testa telas e APIs a partir deles. Extensível por plugins.

**Status:** F0–F4 rodando — `ui-testing`, `api-testing`, `reports` (relatório + pacote de falha) e `integrations` (Jira com dedupe), cada um com painel no shell. Detalhes no [STATUS](STATUS.md).

---

## Começando (F0)

Pré-requisitos: Node ≥ 20 e pnpm (via Corepack).

```bash
corepack enable                 # habilita o pnpm (necessário também para o turbo)
pnpm install                    # instala o workspace
pnpm run runner list            # lista os plugins registrados
pnpm run runner -- run example --env qa --url https://qa.exemplo.com
pnpm build                      # typecheck de todos os pacotes (via Turborepo)
```

Testes de tela (F1), contra o site de demonstração:

```bash
pnpm run ui-demo                # em outro terminal: http://localhost:4173
pnpm run runner -- run ui-testing --url http://localhost:4173 --mode scan --paths /login,/painel --maps examples/ui-demo/qastage/maps
pnpm run runner -- run ui-testing --url http://localhost:4173 --feature examples/ui-demo/features/login.feature --maps examples/ui-demo/qastage/maps
```

Pelo navegador (shell + painel federado):

```bash
pnpm run ui-demo                       # site de demo  :4173
pnpm --filter @qastage/runner dev      # API do runner :4000
pnpm --filter @qastage/plugin-ui dev   # remote do painel :5174
pnpm --filter @qastage/reports dev     # remote do histórico :5175
pnpm --filter @qastage/shell dev       # http://localhost:5173 → "Telas (UI)" / "Relatórios"
```

Toda execução grava `artifacts/<plugin>/<id>/report.html` e, por falha, `falhas/NN-cenario/falha.md`.

Testes de API (F4), contra a API de demonstração (que tem 2 bugs plantados):

```bash
pnpm run api-demo                      # http://localhost:4280 (spec em /openapi.json)
pnpm run runner -- run api-testing --env qa --url http://localhost:4280 --feature examples/api-demo/features/clientes.feature
pnpm run runner -- run api-testing --env qa --url http://localhost:4280 --feature examples/api-demo/features/falhas.feature
pnpm --filter @qastage/plugin-api dev  # painel "APIs" :5176
```

Jira (opcional): copie [.env.example](.env.example) para `.env` e preencha. Para testar sem Jira real,
`pnpm run jira-fake` sobe um Jira de mentira na porta 4180.

O comando `run example` carrega o plugin de exemplo, executa o seu *executor* e
grava um artefato em `artifacts/`. É a prova do contrato ponta a ponta do F0:
o runner não conhece o plugin por dentro, só o contrato (`@qastage/core-contract`).

O coração do F0 é [`packages/core-contract`](packages/core-contract/src/index.ts):
um plugin fornece um **executor** (Cucumber, k6 ou outro), não "passos de Cucumber".

---

## Visão e objetivos

Uma plataforma onde o QA escreve apenas arquivos `.feature` e testa tanto telas quanto APIs, para ganhar performance e padronizar os testes do time.

- **Entrada única:** o QA compõe cenários em Gherkin a partir de um vocabulário fixo de passos reutilizáveis — quase sem escrever código.
- **Duas frentes, uma base:** telas (via navegador) e endpoints (via Swagger/Postman) reusam os mesmos dados e a mesma estrutura.
- **Funciona em projeto legado:** nem todo projeto tem Swagger ou `data-testid`. O sistema degrada para mapeamento mais manual em vez de travar.
- **Princípio inegociável:** o QA nunca é bloqueado por falta de contrato (Swagger ausente, `data-testid` esquecido, auth incomum). Sempre há um caminho manual de saída.

## Princípios de design

Cinco regras orientam todas as decisões abaixo.

1. **Nunca bloquear o QA.** Todo caminho automatizado tem uma saída manual. Falta de `data-testid`, de Swagger ou de auth padrão nunca impede o QA de criar e rodar um teste.
2. **Zero LLM no caminho crítico.** Mapear endpoints (Swagger), resolver campos (`data-testid`) e gerar dados (geradores) é tudo determinístico. IA é opcional, cacheada e nunca necessária para rodar um teste.
3. **Tudo que varia por projeto é um adapter plugável.** Fonte de endpoints, autenticação, estratégia de localização e navegadores são configuração, não código novo.
4. **O `.feature` é a porta de entrada.** O QA compõe a partir de um vocabulário fechado de passos; cada módulo contribui com o seu.
5. **Extensibilidade por plugins.** Um novo tipo de teste entra como um plugin, sem reescrever o núcleo.

## Arquitetura macro

O QA autora no front (MFE); o Runner (Node) executa com Cucumber + Playwright e devolve o resultado. O front nunca roda Playwright. Os artefatos de cada execução alimentam o relatório e a integração com o Jira.

```mermaid
flowchart LR
    QA([QA])
    subgraph Shell["Shell — front (MFE, React + TS)"]
        direction TB
        M1[ui-testing]
        M2[api-testing]
        M3[data]
        M4[reports]
        M5[integrations]
        M6[load-testing]
    end
    subgraph Runner["Runner (Node + TS)"]
        direction TB
        R1[Registro de plugins]
        R2[Cucumber]
        R3[Playwright]
    end
    subgraph Alvos["Alvos"]
        direction TB
        A1[Telas - via navegadores]
        A2[APIs - Swagger/Postman]
    end
    Art[Artefatos: Reports e Jira]

    QA -->|escreve .feature| Shell
    Shell -->|API HTTP| Runner
    Runner -->|executa| Alvos
    Runner -->|emite| Art
```

## Contrato de plugin

Cada tipo de teste é um plugin, e todo plugin contribui em **duas metades ao mesmo tempo** — é isso que torna o sistema realmente plugável, e não só visual.

- **Metade do front (micro-frontend):** o painel onde o QA escolhe telas/endpoints, escreve o `.feature` daquele tipo e vê o relatório. É um *remote* federado no shell.
- **Metade do runner (pacote Node/TS):** a biblioteca de passos Gherkin daquele tipo + os hooks de execução.

Adicionar um módulo = **um micro-frontend novo** (federado no shell) **+ um pacote de passos novo** (registrado no runner). O manifesto do plugin declara o nome, o remote do front e o ponto de registro no back.

**Nem todo plugin usa Cucumber.** O contrato modela um *executor*, não "passos de Cucumber": uns plugins fornecem passos Gherkin (ui, api), outros trazem o próprio motor — o plugin de carga roda o k6, que tem runtime próprio. Cucumber é um executor entre outros.

## Mapa de módulos

Cada módulo (exceto o core) é um plugin com as duas metades descritas acima.

| Módulo | Responsabilidade |
| --- | --- |
| core / shell | Host do micro-frontend, navegação, seleção de ambiente, auth do próprio sistema e o contrato de plugin. |
| ui-testing | Telas: scan de `data-testid`, mapa por tela com fallback do QA, passos de tela. |
| api-testing | APIs: ingestão de Swagger/Postman, geração de corpo, validação de schema, testes negativos. |
| load-testing | Carga com k6: gera o script a partir dos endpoints e dados, roda o k6 e envia as métricas ao reports. Só em ambiente autorizado. |
| data | Fixtures + geradores BR válidos; preenchimento automático por nome de campo + override. |
| reports & artifacts | Prints de sucesso/falha, relatório navegável, armazenamento de artefatos. |
| integrations | Jira (card na falha) e, no futuro, Slack e outros. |

## Adapters por projeto

O que varia de um projeto para outro não entra como código novo, e sim como um adapter configurado por projeto. São quatro eixos.

| Eixo | Opções | Fallback para legado |
| --- | --- | --- |
| Fonte de endpoints | OpenAPI/Swagger, Postman collection, Insomnia, HAR | Importa a collection antiga que o time já usava |
| Autenticação | Bearer via login, API key, OAuth2, SSO | SSO: captura a sessão autenticada uma vez (`storageState` do Playwright) e reusa |
| Localização de elemento | `data-testid`, semântico (role/label/placeholder), manual | Mapa manual editado pelo QA quando não há testid |
| Navegadores | Chromium, Firefox, WebKit | Matriz por projeto, para sistemas antigos que exigem mais de um |

- **Nem todo projeto tem Swagger.** Por isso a fonte de endpoints é um adapter: um projeto aponta o link do Swagger, outro sobe uma collection do Postman. O resto do pipeline é o mesmo.
- **SSO existe.** A autenticação é uma estratégia plugável. Para SSO, o fluxo interativo roda uma vez e a sessão fica salva; os testes reusam sem passar pelo IdP a cada execução.

## Testes de tela (UI)

O QA escreve rótulos humanos; o runner resolve o elemento sem gastar tokens. A resolução segue uma cadeia, parando no primeiro acerto.

1. **`data-testid`** derivado do slug do rótulo ("Finalizar pedido" → `finalizar-pedido`).
2. **Semântico:** `getByRole`, `getByLabel`, `getByPlaceholder`, `getByText`. Cobre telas acessíveis sem testid.
3. **Fallback manual do QA:** quando o front esqueceu o testid, o QA informa outro identificador (atributo, css, texto). Vira uma entrada no mapa de exceções.

**Scan e mapa.** Um crawler lê o DOM de cada tela, encontra os `data-testid` e grava um mapa por tela. Os testes rodam pelo mapa; ele só é regerado quando a tela muda.

**Convenção com o dev:** o `data-testid` é o slug do rótulo visível. Assim o QA escreve o rótulo natural e o dev nomeia o testid igual, sem tabela de-para.

## Testes de API

O QA carrega a fonte (link do Swagger ou collection do Postman) e o sistema mapeia todos os endpoints — sem LLM. O parser extrai caminhos, métodos, parâmetros, schema do corpo, schema da resposta e esquema de auth.

Com isso o sistema, de forma determinística:

- **Gera um corpo estruturalmente válido** a partir do schema (`required`/`enum` respeitados).
- **Valida a resposta contra o schema** do endpoint (via ajv) — pega quebra de contrato de graça.
- **Monta testes negativos quase sem esforço:** tirar um campo obrigatório ou mandar tipo errado e exigir `4xx`.

**Swagger só com tipos.** Como os Swagger costumam vir só com a definição de tipo (`{ nome: string }`), sem exemplos, a estrutura sai do schema e o **valor** válido sai do módulo de dados por nome de campo. A sequência entre endpoints o QA descreve no `.feature`; o token vem do adapter de auth.

## Dados e fixtures

O dado segue um fluxo em três passos, sem LLM: o schema dá a forma, o provedor preenche por nome de campo, o QA sobrescreve o que for específico.

- **Preenchimento automático por nome de campo.** O schema diz que existe um campo `cpf`; um provedor resolve `cpf` para um CPF válido.
- **Override por fixture.** Quando o caso exige um dado específico, o QA aponta uma fixture nomeada.
- **Geradores BR válidos.** CPF, CNPJ e CEP são gerados já válidos. Dado em português válido sai de gerador determinístico, melhor que de IA.
- **Dados compartilhados entre UI e API.** A mesma fixture de cliente testa a tela e o endpoint.

## Relatórios, artefatos e Jira

Cada execução gera artefatos (prints, logs, HAR, vídeo) que alimentam documentação, relatório e integração.

- **Prints como documentação viva.** Captura em sucesso também, passo a passo.
- **Relatório de falha para o dev.** No erro, o runner emite um pacote estruturado (cenário, passo que falhou, print, logs, ambiente, dado usado).
- **Armazenamento de artefatos.** Filesystem no POC; object storage em produção.

**Integração Jira.** Um plugin `integrations/jira` cria ou atualiza o card na falha, com prints e documentação anexados. Dois cuidados obrigatórios:

- **Dedupe.** Chave por cenário + fingerprint da falha. Se já existe card aberto, comenta/atualiza em vez de abrir outro.
- **Assíncrono e opcional.** A integração nunca trava nem derruba a execução se o Jira estiver fora.

## Ambientes e cross-browser

A URL não fica escrita no `.feature`; vem da config de ambientes, para o mesmo cenário rodar em qualquer lugar.

- **Config de ambientes:** `dev`, `qa`, `homolog`, cada um com `baseUrl` e `authUrl`. O QA roda `--env qa` ou passa `--url http://localhost:3000` para o caso local.
- **Matriz de navegadores:** Chromium, Firefox e WebKit por projeto.
- **Ambiente seguro para escrita:** endpoints de escrita criam registros de verdade. O sistema marca quais ambientes aceitam escrita, para não sujar homolog sem querer.

## Estrutura do repositório

Um **monorepo único** com workspaces, front e runner juntos. O motivo decisivo é o contrato de plugin ter duas metades (front + back) — um plugin muda atômico num só PR, e os tipos compartilhados são `import`, não pacote publicado. Repo único não impede deploy independente: o Module Federation carrega cada remote em runtime.

```
qastage/
  apps/
    shell/          # host MFE (React + TS)
    runner/         # servico Node + TS (Cucumber/Playwright)
  packages/
    core-contract/  # manifesto de plugin + tipos compartilhados
    data/           # fixtures + geradores BR
    reports/
    plugin-ui/      # web/ (remote) + runner/ (passos)
    plugin-api/
    plugin-load/    # k6
```

Cada plugin é um pacote com as duas pontas dentro. Workspace: pnpm + Turborepo. Front: Module Federation via `@module-federation/vite`, com os remotes registrados em runtime a partir do manifesto de cada plugin.

## IA assistiva (versão futura)

Não implementado — registrado para uma versão futura. Hoje o QAStage não usa nenhuma IA, e isso é proposital
(princípio 2): achar campos, gerar corpo e validar contrato é tudo determinístico, sem custo por execução e
com o mesmo resultado sempre.

**Como entraria:** um módulo `ai` como **adapter opcional por projeto**, igual ao Jira. IA desligada ou fora
do ar nunca impede um teste de rodar; o que ela sugere o QA confirma, e o resultado fica salvo para repetir igual.

| Uso | Onde | Saída |
| --- | --- | --- |
| Sugerir seletor quando um campo não resolve | Formulário de exceção (ui-testing) | Seletor proposto; o QA confirma e vira exceção no mapa |
| Rascunhar o `.feature` | A partir dos endpoints (api-testing) ou do mapa de uma tela | Rascunho no editor, para o QA revisar |
| Resumir a falha | Card do Jira (integrations) | Parágrafo em linguagem simples no topo do card |
| Valores de teste realistas | Campos que o módulo `data` não conhece | Valor gerado uma vez e salvo como fixture |

**Provedor:** a empresa usa hoje o **GitHub Copilot**. O Copilot não oferece uma API genérica para um sistema
terceiro chamar como assistente, então o caminho provável é o **GitHub Models** ou o **Azure OpenAI** — a
confirmar com a área de TI/segurança antes de implementar. O adapter teria a forma:

```
QASTAGE_AI_PROVIDER=github-models | azure-openai | openai | anthropic | ollama | none   # padrão: none
QASTAGE_AI_MODEL=...
QASTAGE_AI_KEY=...
```

**Cuidados a definir:** o que pode ser enviado ao provedor (HTML de tela e corpo de API podem ter dado
pessoal; segredos já são mascarados), custo por uso e cache das respostas.

## Roadmap por fases

Começa pelas telas, que é a prioridade do time. Cada fase entrega valor usável.

| Fase | Entrega | Gate para a próxima |
| --- | --- | --- |
| F0 | Contrato de plugin + esqueleto (shell MFE + runner com registro dinâmico de passos) | Um plugin de exemplo roda ponta a ponta |
| F1 | ui-testing: scan de `data-testid`, mapa com fallback, passos de tela | Um `.feature` roda contra uma URL e resolve campos |
| F2 | reports & artifacts: prints de sucesso/falha, relatório navegável | Falha gera pacote estruturado para o dev |
| F3 | integrations/jira: card automático na falha, com dedupe | Falha abre/atualiza card com anexos |
| F4 | api-testing: Swagger/Postman, schema, negativos | Endpoint validado contra o schema |
| F5 | load-testing: k6 a partir dos endpoints e dados | Carga roda em homolog autorizado, com thresholds |
| Futuro | ai (opcional): sugestão de seletor, rascunho de `.feature`, resumo de falha | Nenhum teste depende da IA para rodar |

## Decisões em aberto

- **IA assistiva:** provedor (GitHub Models / Azure OpenAI, alinhado ao Copilot da empresa) e política de dados — ver "IA assistiva (versão futura)".
- **SSO:** o fluxo exato varia por projeto (SAML/OIDC, MFA); cada projeto que usa SSO precisa de uma captura inicial de sessão.
