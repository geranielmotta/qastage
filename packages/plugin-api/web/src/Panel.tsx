import type { PanelProps, RunResult } from "@qastage/core-contract";
import { fileUrl, getJson, pluginApi, runAndWait, type RunRecord } from "@qastage/web-kit";
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

const cabecalho = (fonte: string) => `# language: pt
Funcionalidade: API

  Contexto:
    Dado que a API é descrita em "${fonte}"
    E que eu faço login em "POST /auth/login" com:
      | email | qa@empresa.com |
      | senha | segredo        |
`;

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
export default function Panel({ apiBase, env }: PanelProps) {
  const [apiUrl, setApiUrl] = useApiUrl(env);
  const [fonte, setFonte] = useState(FONTE_PADRAO);
  const [catalogo, setCatalogo] = useState<Catalogo | null>(null);
  const [erroFonte, setErroFonte] = useState<string | null>(null);
  const [feature, setFeature] = useState(() => cabecalho(FONTE_PADRAO));
  const [rodando, setRodando] = useState(false);
  const [rec, setRec] = useState<RunRecord | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = async () => {
    setErroFonte(null);
    try {
      const c = await getJson<Catalogo>(pluginApi(apiBase, "api-testing", `/endpoints?fresh=true&spec=${encodeURIComponent(fonte)}`));
      setCatalogo(c);
      if (!feature.includes("Cenário:")) setFeature(cabecalho(fonte));
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
      await runAndWait(apiBase, { plugin: "api-testing", env: { ...env, baseUrl: apiUrl }, featureText: feature, params: {} }, setRec);
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
        {env.name === "homolog" && " · só leitura: POST/PUT/PATCH/DELETE são bloqueados"}
      </p>

      <div className="linha">
        <label>
          URL da API neste ambiente
          <input value={apiUrl} onChange={(e) => setApiUrl(e.target.value)} size={30} />
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
