import type { PanelProps, RunResult } from "@qastage/core-contract";
import { FeatureFiles, fileUrl, runAndWait, runTarget, type RunRecord } from "@qastage/web-kit";
import { useState } from "react";
import { css } from "./styles";

const EXEMPLO = `# language: pt
Funcionalidade: Carga na API de clientes

  Contexto:
    Dado que a API é descrita em "examples/api-demo/openapi.json"
    E que eu faço login em "POST /auth/login" com:
      | email | qa@empresa.com |
      | senha | segredo        |

  Cenário: Consulta e cadastro no dia a dia
    Dado 5 usuários virtuais por "10s"
    E cada usuário espera "500ms" entre as requisições
    E cada usuário executa:
      | endpoint       | peso |
      | GET /clientes  | 3    |
      | POST /clientes | 1    |
    Então o p95 deve ser menor que 1000 ms
    E a taxa de erro deve ser menor que "1%"
`;

const ICONE: Record<RunResult["status"], string> = { passed: "✓", failed: "✗", error: "✗", skipped: "–" };

/** Painel do plugin load-testing: escreve a carga em Gherkin, roda o k6 no runner e mostra as métricas. */
export default function Panel({ apiBase, env, project, file }: PanelProps) {
  // Com qastage.config.json o ambiente já traz a URL da API e a autorização de carga.
  const daConfig = !!env.apiUrl;
  const [apiUrl, setApiUrl] = useState(() => {
    try {
      return localStorage.getItem(`qastage.api-url.${env.name}`) ?? env.baseUrl;
    } catch {
      return env.baseUrl;
    }
  });
  const [feature, setFeature] = useState(EXEMPLO);
  const [rodando, setRodando] = useState(false);
  const [rec, setRec] = useState<RunRecord | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const executar = async () => {
    setRodando(true);
    setErro(null);
    setRec(null);
    try {
      await runAndWait(apiBase, { plugin: "load-testing", ...(project || daConfig ? runTarget({ env, ...(project ? { project } : {}) }) : { env: { ...env, baseUrl: apiUrl } }), featureText: feature, params: {} }, setRec);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setRodando(false);
    }
  };

  const r = rec?.result;
  return (
    <div className="qload">
      <style>{css}</style>
      <h1>Testes de carga</h1>
      <p className="sub">
        Ambiente <strong>{env.name}</strong> · roda com k6 no runner ·{" "}
        {env.allowLoad ? (
          <strong>carga liberada neste ambiente</strong>
        ) : (
          <>só em ambiente autorizado (<code>"carga": true</code> no qastage.config.json, ou URL local)</>
        )}
      </p>
      <div className="linha">
        <label>
          URL da API neste ambiente
          {daConfig ? (
            <input value={env.apiUrl} readOnly size={32} title="Definida no qastage.config.json" />
          ) : (
            <input value={apiUrl} onChange={(e) => setApiUrl(e.target.value)} size={32} />
          )}
        </label>
        <button className="primario" onClick={executar} disabled={rodando}>{rodando ? "Executando carga…" : "Executar carga"}</button>
      </div>
      {project && (
        <FeatureFiles apiBase={apiBase} project={project} plugin="load-testing" folder="features/carga" text={feature} onOpen={setFeature} {...(file ? { initial: file } : {})} />
      )}
      <textarea value={feature} onChange={(e) => setFeature(e.target.value)} spellCheck={false} aria-label="Arquivo .feature de carga" />
      {erro && <pre className="erro">{erro}</pre>}

      {rec && (
        <div className="card">
          <h2>
            Resultado {r ? <span className={`status ${r.status}`}>{r.status}</span> : <span className="status skipped">executando…</span>}
            {rec.reportUrl && (
              <a className="relatorio" href={apiBase + rec.reportUrl} target="_blank" rel="noreferrer">Abrir relatório completo ↗</a>
            )}
          </h2>
          {r?.status === "error" && <pre className="erro">{r.error}</pre>}
          {r?.metrics && (
            <div className="metricas">
              {Object.entries(r.metrics).map(([k, v]) => (
                <div key={k} className="metrica">
                  <span className="valor">{v.toLocaleString("pt-BR")}</span>
                  <span className="nome">{k}</span>
                </div>
              ))}
            </div>
          )}
          <ul className="passos">
            {r?.steps?.map((s, i) => (
              <li key={i} className={s.status}>
                {ICONE[s.status]} {s.name}
                {s.error && s.status === "failed" && <pre className="erro">{s.error}</pre>}
              </li>
            ))}
          </ul>
          {r?.artifacts.length ? (
            <p className="arquivos">
              {r.artifacts.map((a) => (
                <a key={a.path} href={fileUrl(apiBase, a.path)} target="_blank" rel="noreferrer">{a.label}</a>
              ))}
            </p>
          ) : null}
          {!r && <pre className="log">{rec.logs.map((l) => l.msg).join("\n")}</pre>}
        </div>
      )}
    </div>
  );
}
