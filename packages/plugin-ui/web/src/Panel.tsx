import type { PanelProps, RunResult } from "@qastage/core-contract";
import { useEffect, useRef, useState } from "react";
import {
  fetchFileJson,
  fetchSteps,
  fileUrl,
  runAndWait,
  saveException,
  type NaoEncontrado,
  type Resolucao,
  type RunRecord,
  type ScreenMap,
} from "./api";
import { css } from "./styles";

const FEATURE_EXEMPLO = `# language: pt
Funcionalidade: Login no sistema de demonstração

  Contexto:
    Dado que eu acesso "/login"

  Cenário: Login com sucesso
    Quando eu preencho "E-mail" com "qa@empresa.com"
    E eu preencho "Senha" com "segredo"
    E eu seleciono "Desenvolvedor" em "Perfil"
    E eu marco "Lembrar de mim"
    E eu clico em "Entrar"
    Então eu devo estar em "/painel"
    E eu devo ver "Bem-vindo, qa@empresa.com"
`;

const ESTRATEGIA: Record<Resolucao["estrategia"], string> = {
  manual: "exceção manual",
  testid: "data-testid",
  "testid-mapa": "testid pelo mapa",
  semantico: "semântico",
};

/** Painel do plugin ui-testing: escreve/roda .feature e escaneia telas. */
export default function Panel({ apiBase, env }: PanelProps) {
  const [aba, setAba] = useState<"executar" | "scan">("executar");
  const [maps, setMaps] = useState("examples/ui-demo/qastage/maps");
  const [browser, setBrowser] = useState("chromium");

  return (
    <div className="qui">
      <style>{css}</style>
      <h1>Testes de tela</h1>
      <p className="sub">
        Ambiente <strong>{env.name}</strong> · <code>{env.baseUrl}</code>
      </p>
      <div className="abas" role="tablist">
        <button role="tab" className={aba === "executar" ? "ativa" : ""} onClick={() => setAba("executar")}>Executar .feature</button>
        <button role="tab" className={aba === "scan" ? "ativa" : ""} onClick={() => setAba("scan")}>Escanear telas</button>
      </div>
      <div className="linha">
        <label>
          Pasta dos mapas
          <input value={maps} onChange={(e) => setMaps(e.target.value)} size={36} />
        </label>
        <label>
          Navegador
          <select value={browser} onChange={(e) => setBrowser(e.target.value)}>
            <option>chromium</option>
            <option>firefox</option>
            <option>webkit</option>
          </select>
        </label>
      </div>
      {aba === "executar" ? (
        <Executar apiBase={apiBase} env={env} params={{ maps, browser }} />
      ) : (
        <Escanear apiBase={apiBase} env={env} params={{ maps, browser }} />
      )}
    </div>
  );
}

interface AbaProps extends PanelProps {
  params: Record<string, string>;
}

function useRun(apiBase: string) {
  const [rodando, setRodando] = useState(false);
  const [rec, setRec] = useState<RunRecord | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const disparar = async (body: unknown): Promise<RunRecord | null> => {
    setRodando(true);
    setErro(null);
    setRec(null);
    try {
      return await runAndWait(apiBase, body, setRec);
    } catch (e) {
      setErro((e as Error).message);
      return null;
    } finally {
      setRodando(false);
    }
  };
  return { rodando, rec, erro, disparar };
}

function Executar({ apiBase, env, params }: AbaProps) {
  const [feature, setFeature] = useState(FEATURE_EXEMPLO);
  const [resolucoes, setResolucoes] = useState<Resolucao[]>([]);
  const [passos, setPassos] = useState<string[]>([]);
  const editor = useRef<HTMLTextAreaElement>(null);
  const { rodando, rec, erro, disparar } = useRun(apiBase);

  useEffect(() => {
    fetchSteps(apiBase).then(setPassos).catch(() => setPassos([]));
  }, [apiBase]);

  /** Insere o passo na linha seguinte à do cursor, com aspas vazias para o QA preencher. */
  const inserir = (padrao: string) => {
    const linha = "    E " + padrao.replace("(que )", "").replace(/\{string\}/g, '""');
    const el = editor.current;
    const pos = el ? feature.indexOf("\n", el.selectionStart) : -1;
    const corte = pos === -1 ? feature.length : pos;
    const novo = feature.slice(0, corte) + (feature.slice(0, corte).endsWith("\n") || corte === 0 ? "" : "\n") + linha + feature.slice(corte);
    setFeature(novo);
    requestAnimationFrame(() => {
      if (!el) return;
      const cursor = novo.indexOf(linha, corte) + linha.indexOf('""') + 1;
      el.focus();
      el.setSelectionRange(cursor, cursor);
    });
  };

  const executar = async () => {
    setResolucoes([]);
    const fim = await disparar({ plugin: "ui-testing", env, featureText: feature, params });
    const arq = fim?.result?.artifacts.find((a) => a.path.endsWith("resolucoes.json"));
    if (arq) setResolucoes(await fetchFileJson<Resolucao[]>(apiBase, arq.path));
  };

  return (
    <>
      <div className="editor">
        <textarea ref={editor} value={feature} onChange={(e) => setFeature(e.target.value)} spellCheck={false} aria-label="Arquivo .feature" />
        {passos.length > 0 && (
          <aside className="vocab" aria-label="Passos disponíveis">
            <strong>Passos disponíveis</strong>
            <small>clique para inserir após o cursor</small>
            {passos.map((p) => (
              <button key={p} type="button" onClick={() => inserir(p)} title={p}>
                <code>{p.replace("(que )", "").replace(/\{string\}/g, '"…"')}</code>
              </button>
            ))}
          </aside>
        )}
      </div>
      <div className="linha" style={{ marginTop: 10 }}>
        <button className="primario" onClick={executar} disabled={rodando}>{rodando ? "Executando…" : "Executar"}</button>
      </div>
      {erro && <pre>{erro}</pre>}
      {rec && <Resultado apiBase={apiBase} rec={rec} maps={params.maps!} onCorrigido={executar} />}
      {resolucoes.length > 0 && (
        <div className="card">
          <h2>Como cada campo foi encontrado</h2>
          <div className="tabela">
            <table>
              <thead><tr><th>Cenário</th><th>Tela</th><th>Rótulo</th><th>Estratégia</th><th>Localizador</th></tr></thead>
              <tbody>
                {resolucoes.map((r, i) => (
                  <tr key={i}>
                    <td>{r.cenario}</td><td>{r.tela}</td><td>{r.rotulo}</td>
                    <td><span className="tag">{ESTRATEGIA[r.estrategia]}</span></td>
                    <td><code>{r.como}</code></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}

function Escanear({ apiBase, env, params }: AbaProps) {
  const [paths, setPaths] = useState("/login, /painel");
  const [mapas, setMapas] = useState<ScreenMap[]>([]);
  const { rodando, rec, erro, disparar } = useRun(apiBase);

  const escanear = async () => {
    setMapas([]);
    const fim = await disparar({ plugin: "ui-testing", env, params: { ...params, mode: "scan", paths } });
    const arquivos = fim?.result?.artifacts.filter((a) => a.path.endsWith(".json")) ?? [];
    setMapas(await Promise.all(arquivos.map((a) => fetchFileJson<ScreenMap>(apiBase, a.path))));
  };

  return (
    <>
      <div className="linha">
        <label>
          Telas (separadas por vírgula)
          <input value={paths} onChange={(e) => setPaths(e.target.value)} size={40} />
        </label>
        <button className="primario" onClick={escanear} disabled={rodando}>{rodando ? "Escaneando…" : "Escanear"}</button>
      </div>
      {erro && <pre>{erro}</pre>}
      {rec && <Resultado apiBase={apiBase} rec={rec} />}
      {mapas.map((m) => (
        <div className="card" key={m.screen}>
          <h2>Tela <code>{m.screen}</code> · {m.elements.length} com testid · {m.missingTestid.length} sem</h2>
          <div className="tabela">
            <table>
              <thead><tr><th>Elemento</th><th>Rótulo</th><th>{m.testIdAttribute}</th></tr></thead>
              <tbody>
                {m.elements.map((e, i) => (
                  <tr key={`c${i}`}><td><code>&lt;{e.tag}&gt;</code></td><td>{e.label ?? "—"}</td><td><code className="passed">{e.testid}</code></td></tr>
                ))}
                {m.missingTestid.map((e, i) => (
                  <tr key={`s${i}`}>
                    <td><code>&lt;{e.tag}&gt;</code></td>
                    <td>{e.label ?? "—"}</td>
                    <td className="failed">
                      sem testid{e.suggestedTestid && <> · sugerido <code>{e.suggestedTestid}</code></>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </>
  );
}

const ICONE: Record<RunResult["status"], string> = { passed: "✓", failed: "✗", error: "✗", skipped: "–" };

interface ResultadoProps {
  apiBase: string;
  rec: RunRecord;
  /** Presentes na aba de execução: permitem gravar a exceção manual e reexecutar. */
  maps?: string;
  onCorrigido?: () => void;
}

function Resultado({ apiBase, rec, maps, onCorrigido }: ResultadoProps) {
  const r = rec.result;
  const prints = r?.artifacts.filter((a) => a.kind === "screenshot") ?? [];
  const falhas = r?.steps?.filter((s) => s.status === "failed" && s.error) ?? [];
  return (
    <div className="card">
      <h2>
        Resultado{" "}
        {r ? <span className={`status ${r.status}`}>{r.status}</span> : <span className="status skipped">executando</span>}
      </h2>
      {r?.status === "error" && <pre>{r.error}</pre>}
      {r?.steps && (
        <ul className="passos">
          {r.steps.map((s, i) => (
            <li key={i} className={s.status}>
              {ICONE[s.status]} {s.name} {s.status !== "skipped" && <small>({s.durationMs} ms)</small>}
            </li>
          ))}
        </ul>
      )}
      {falhas.map((s, i) => {
        const d = s.details as NaoEncontrado | undefined;
        if (d?.kind === "elemento-nao-encontrado" && maps !== undefined && onCorrigido) {
          return <Excecao key={i} apiBase={apiBase} maps={maps} falha={d} onSalvo={onCorrigido} />;
        }
        return <pre key={i}>{s.name}{"\n\n"}{s.error}</pre>;
      })}
      {prints.length > 0 && (
        <div className="prints" style={{ marginTop: 12 }}>
          {prints.map((p) => (
            <a key={p.path} href={fileUrl(apiBase, p.path)} target="_blank" rel="noreferrer">
              <img src={fileUrl(apiBase, p.path)} alt={p.label ?? "print"} />
              {p.label}
            </a>
          ))}
        </div>
      )}
      {!r && <pre className="log">{rec.logs.map((l) => l.msg).join("\n")}</pre>}
    </div>
  );
}

const TIPOS = { css: "Seletor CSS", testid: "data-testid", text: "Texto exato", xpath: "XPath" } as const;

/** Saída manual do QA: diz como achar o elemento e segue sem esperar o dev. */
function Excecao({ apiBase, maps, falha, onSalvo }: { apiBase: string; maps: string; falha: NaoEncontrado; onSalvo: () => void }) {
  const [tipo, setTipo] = useState<keyof typeof TIPOS>("css");
  const [valor, setValor] = useState("");
  const [todas, setTodas] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const salvar = async () => {
    setErro(null);
    try {
      await saveException(apiBase, { maps, tela: todas ? "*" : falha.tela, rotulo: falha.rotulo, locator: { [tipo]: valor } });
      onSalvo();
    } catch (e) {
      setErro((e as Error).message);
    }
  };

  return (
    <div className="excecao">
      <p>
        Não encontrei <strong>"{falha.rotulo}"</strong> na tela <code>{falha.tela}</code>. Tentei:
      </p>
      <ul>{falha.tentativas.map((t) => <li key={t}><code>{t}</code></li>)}</ul>
      <p>Diga como achar esse elemento (vira uma exceção no mapa da tela):</p>
      <div className="linha">
        <label>
          Tipo
          <select value={tipo} onChange={(e) => setTipo(e.target.value as keyof typeof TIPOS)}>
            {Object.entries(TIPOS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label>
          Valor
          <input value={valor} onChange={(e) => setValor(e.target.value)} size={30} placeholder={tipo === "css" ? ".btn-entrar" : ""} />
        </label>
        <label className="check">
          <input type="checkbox" checked={todas} onChange={(e) => setTodas(e.target.checked)} /> valer em todas as telas
        </label>
        <button className="primario" disabled={!valor.trim()} onClick={salvar}>Salvar e executar de novo</button>
      </div>
      {erro && <pre>{erro}</pre>}
    </div>
  );
}
