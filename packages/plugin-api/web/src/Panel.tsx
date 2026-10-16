import type { PanelProps, RunResult } from "@qastage/core-contract";
import { FeatureFiles, fileUrl, getJson, pluginApi, runAndWait, runTarget, withProject, type RunRecord } from "@qastage/web-kit";
import { useEffect, useState } from "react";
import { css } from "./styles";

interface EndpointResumo {
  id: string;
  method: string;
  path: string;
  operationId?: string;
  summary?: string;
  secured: boolean;
  hasBody: boolean;
  required: string[];
  statuses: string[];
}

interface Catalogo {
  title: string;
  kind: "openapi3" | "swagger2" | "postman";
  endpoints: EndpointResumo[];
}

const FONTE_PADRAO = "examples/api-demo/openapi.json";
const KIND = { openapi3: "OpenAPI 3", swagger2: "Swagger 2", postman: "Postman" } as const;

/** Endpoint de login: POST cujo caminho fala de login/auth/token/sessão. */
function acharLogin(c: Catalogo | null): EndpointResumo | undefined {
  return c?.endpoints.find((e) => e.method === "POST" && /login|auth|token|sess(ion|ao)|signin/i.test(e.path));
}

/** Variável do .env para cada campo de credencial: o valor nunca fica no .feature. */
function variavel(campo: string): string {
  if (/senha|pass/i.test(campo)) return "${QA_SENHA}";
  if (/e-?mail|user|usuario|login/i.test(campo)) return "${QA_USUARIO}";
  return `\${QA_${campo.toUpperCase()}}`;
}

/**
 * Cabeçalho do rascunho. A fonte só entra quando não é a padrão do projeto;
 * o login vem do Swagger (se houver endpoint de login) com credenciais do .env.
 */
function cabecalho(fonte: string | null, login?: EndpointResumo): string {
  const linhas = ["# language: pt", "Funcionalidade: API", ""];
  const contexto: string[] = [];
  if (fonte) contexto.push(`Dado que a API é descrita em "${fonte}"`);
  if (login) {
    contexto.push(`${contexto.length ? "E" : "Dado"} que eu faço login em "${login.id}" com:`);
    const largura = Math.max(...login.required.map((c) => c.length), 5);
    for (const c of login.required.length ? login.required : ["usuario", "senha"]) contexto.push(`  | ${c.padEnd(largura)} | ${variavel(c)} |`);
  }
  if (contexto.length) {
    linhas.push("  # Credenciais vêm do .env da raiz do QAStage (QA_USUARIO, QA_SENHA): nunca no .feature.");
    linhas.push("  Contexto:", ...contexto.map((l) => `    ${l}`));
  }
  return linhas.join("\n") + "\n";
}

/** URL da API por ambiente: no shell o ambiente tem a URL do front; a da API pode ser outra. */
function useApiUrl(env: PanelProps["env"]): [string, (v: string) => void] {
  const chave = `qastage.api-url.${env.name}`;
  const ler = () => {
    try {
      return localStorage.getItem(chave) ?? env.baseUrl;
    } catch {
      return env.baseUrl;
    }
  };
  const [url, setUrl] = useState(ler);
  useEffect(() => setUrl(ler()), [env.name, env.baseUrl]); // eslint-disable-line react-hooks/exhaustive-deps
  return [
    url,
    (v) => {
      setUrl(v);
      try {
        localStorage.setItem(chave, v);
      } catch {
        /* sem storage */
      }
    },
  ];
}

/** Gera o trecho Gherkin de um endpoint: chamada, status de sucesso documentado e contrato. */
function cenarioPara(e: EndpointResumo): string {
  const sucesso = e.statuses.find((s) => /^2/.test(s)) ?? "2xx";
  const ref = e.path.includes("{") ? `${e.method} ${e.path}` : e.id;
  return `
  Cenário: ${e.summary ?? e.id}
    Quando eu envio "${ref}"
    Então a resposta deve ter status ${sucesso.replace(/XX$/, "xx")}
    E a resposta deve seguir o contrato
`;
}

function negativosPara(e: EndpointResumo): string {
  return `
  Cenário: ${e.id} recusa dados inválidos
    Então os campos obrigatórios de "${e.id}" devem ser exigidos
    E os tipos dos campos de "${e.id}" devem ser validados
`;
}

/** Painel do plugin api-testing: carrega a fonte, monta o .feature e executa. */
export default function Panel({ apiBase, env, defaults, project, file }: PanelProps) {
  // Com qastage.config.json o ambiente já traz a URL da API: o runner resolve pelo nome.
  const daConfig = !!env.apiUrl;
  const [apiUrl, setApiUrl] = useApiUrl(env);
  const fontePadrao = String(defaults?.spec ?? FONTE_PADRAO);
  const [fonte, setFonte] = useState(fontePadrao);
  const [catalogo, setCatalogo] = useState<Catalogo | null>(null);
  const [erroFonte, setErroFonte] = useState<string | null>(null);
  const ehPadrao = (f: string) => !!defaults?.spec && f === String(defaults.spec);
  const [feature, setFeature] = useState(() => cabecalho(ehPadrao(fontePadrao) ? null : fontePadrao));
  const [rodando, setRodando] = useState(false);
  const [rec, setRec] = useState<RunRecord | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = async () => {
    setErroFonte(null);
    try {
      const c = await getJson<Catalogo>(withProject(pluginApi(apiBase, "api-testing", `/endpoints?fresh=true&spec=${encodeURIComponent(fonte)}`), project));
      setCatalogo(c);
      setFeature((atual) => (atual.includes("Cenário:") ? atual : cabecalho(ehPadrao(fonte) ? null : fonte, acharLogin(c))));
    } catch (e) {
      setCatalogo(null);
      setErroFonte((e as Error).message);
    }
  };
  useEffect(() => void carregar(), []); // eslint-disable-line react-hooks/exhaustive-deps

  const executar = async () => {
    setRodando(true);
    setErro(null);
    setRec(null);
    try {
      await runAndWait(apiBase, { plugin: "api-testing", ...(project || daConfig ? runTarget({ env, ...(project ? { project } : {}) }) : { env: { ...env, baseUrl: apiUrl } }), featureText: feature, params: {} }, setRec);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setRodando(false);
    }
  };

  return (
    <div className="qapi">
      <style>{css}</style>
      <h1>Testes de API</h1>
      <p className="sub">
        Ambiente <strong>{env.name}</strong>
        {env.writable === false && " · só leitura: POST/PUT/PATCH/DELETE são bloqueados"}
      </p>

      <div className="linha">
        <label>
          URL da API neste ambiente
          {daConfig ? (
            <input value={env.apiUrl} readOnly size={30} title="Definida no qastage.config.json" />
          ) : (
            <input value={apiUrl} onChange={(e) => setApiUrl(e.target.value)} size={30} />
          )}
        </label>
        <label className="cresce">
          Fonte dos endpoints (link ou arquivo: OpenAPI, Swagger, Postman)
          <input value={fonte} onChange={(e) => setFonte(e.target.value)} />
        </label>
        <button onClick={carregar}>Carregar</button>
      </div>
      {erroFonte && <pre className="erro">{erroFonte}</pre>}

      <div className="grade">
        <section className="catalogo" aria-label="Endpoints">
          {catalogo && (
            <>
              <p className="sub">
                <strong>{catalogo.title}</strong> · {KIND[catalogo.kind]} · {catalogo.endpoints.length} endpoints
              </p>
              {catalogo.endpoints.map((e) => (
                <div className="ep" key={e.id}>
                  <div className="ep-linha">
                    <span className={`metodo m-${e.method.toLowerCase()}`}>{e.method}</span>
                    <code>{e.path}</code>
                    {e.secured && <span title="exige autenticação">🔒</span>}
                  </div>
                  {e.summary && <div className="sub">{e.summary}</div>}
                  {e.required.length > 0 && <div className="sub">obrigatórios: {e.required.join(", ")}</div>}
                  <div className="ep-acoes">
                    <button onClick={() => setFeature((f) => f.trimEnd() + "\n" + cenarioPara(e))}>+ cenário</button>
                    {e.hasBody && e.required.length > 0 && (
                      <button onClick={() => setFeature((f) => f.trimEnd() + "\n" + negativosPara(e))}>+ negativos</button>
                    )}
                  </div>
                </div>
              ))}
            </>
          )}
        </section>
        <section className="editor">
          {project && (
            <FeatureFiles apiBase={apiBase} project={project} plugin="api-testing" folder="features/api" text={feature} onOpen={setFeature} {...(file ? { initial: file } : {})} />
          )}
          <textarea value={feature} onChange={(e) => setFeature(e.target.value)} spellCheck={false} aria-label="Arquivo .feature" />
          <button className="primario" onClick={executar} disabled={rodando}>{rodando ? "Executando…" : "Executar"}</button>
        </section>
      </div>

      {erro && <pre className="erro">{erro}</pre>}
      {rec && <Resultado apiBase={apiBase} rec={rec} />}
    </div>
  );
}

const ICONE: Record<RunResult["status"], string> = { passed: "✓", failed: "✗", error: "✗", skipped: "–" };

function Resultado({ apiBase, rec }: { apiBase: string; rec: RunRecord }) {
  const r = rec.result;
  return (
    <div className="card">
      <h2>
        Resultado {r ? <span className={`status ${r.status}`}>{r.status}</span> : <span className="status skipped">executando</span>}
        {rec.reportUrl && (
          <a className="relatorio" href={apiBase + rec.reportUrl} target="_blank" rel="noreferrer">Abrir relatório completo ↗</a>
        )}
      </h2>
      {r?.status === "error" && <pre className="erro">{r.error}</pre>}
      <ul className="passos">
        {r?.steps?.map((s, i) => (
          <li key={i} className={s.status}>
            <div>
              {ICONE[s.status]} {s.name} {s.status !== "skipped" && <small>({s.durationMs} ms)</small>}
            </div>
            {s.error && <pre className={s.status === "skipped" ? "aviso" : "erro"}>{s.error}</pre>}
            {s.artifacts?.length ? (
              <div className="trocas">
                {s.artifacts.map((a) => (
                  <a key={a.path} href={fileUrl(apiBase, a.path)} target="_blank" rel="noreferrer">{a.label}</a>
                ))}
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      {!r && <pre className="log">{rec.logs.map((l) => l.msg).join("\n")}</pre>}
    </div>
  );
}
