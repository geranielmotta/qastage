import type { PanelProps } from "@qastage/core-contract";
import { useCallback, useEffect, useState } from "react";
import type { RunSummary } from "../../src/types";

/** Linha do histórico (GET /api/runs): o resumo + onde está o relatório e quem executou. */
type Execucao = Omit<RunSummary, "id" | "status"> & { id: string; status: RunSummary["status"] | "running"; reportId?: string; requestedBy?: string };

const ROTULO = { passed: "passou", failed: "falhou", error: "erro", skipped: "pulado", running: "em execução" } as const;

/** Painel de histórico: toda execução, de qualquer plugin, com o relatório e os pacotes de falha. */
export default function Panel({ apiBase, project }: PanelProps) {
  const [runs, setRuns] = useState<Execucao[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<"todas" | "falhas">("todas");

  const carregar = useCallback(() => {
    fetch(`${apiBase}/api/runs${project ? `?project=${encodeURIComponent(project.id)}` : ""}`, { credentials: "include" })
      .then((r) => r.json() as Promise<Execucao[]>)
      .then(setRuns)
      .catch(() => setErro("Não consegui ler o histórico no runner."));
  }, [apiBase, project]);
  useEffect(carregar, [carregar]);

  const lista = (runs ?? []).filter((r) => filtro === "todas" || r.status !== "passed");
  const url = (id: string, file: string) => `${apiBase}/artifacts/${id}/${file}`;

  return (
    <div className="qrep">
      <style>{css}</style>
      <div className="cab">
        <div>
          <h1>Relatórios</h1>
          <p className="sub">Histórico de execuções{project ? <> do projeto <strong>{project.name}</strong></> : " de todos os projetos"}.</p>
        </div>
        <div className="acoes">
          <select value={filtro} onChange={(e) => setFiltro(e.target.value as typeof filtro)} aria-label="Filtro">
            <option value="todas">Todas</option>
            <option value="falhas">Só com falha</option>
          </select>
          <button onClick={carregar}>Atualizar</button>
        </div>
      </div>
      {erro && <p className="falhou">{erro}</p>}
      {runs && lista.length === 0 && <p className="sub">Nenhuma execução ainda.</p>}
      {lista.map((r) => (
        <article key={r.id} className={`run ${r.status}`}>
          <div className="linha">
            <span className={`selo ${r.status}`}>{ROTULO[r.status]}</span>
            <strong>{r.plugin}</strong>
            <span className="sub">
              {r.env.name} · {new Date(r.startedAt).toLocaleString("pt-BR")} · {(r.durationMs / 1000).toFixed(1)} s
              {r.requestedBy && <> · {r.requestedBy}</>}
            </span>
            <span className="sub">
              {r.counts.passed} ok · {r.counts.failed + r.counts.error} falha · {r.counts.skipped} pulado
            </span>
            {r.reportId && <a className="abrir" href={url(r.reportId, "report.html")} target="_blank" rel="noreferrer">Abrir relatório ↗</a>}
          </div>
          {r.failures.map((f) => (
            <div key={f.dir} className="falha">
              <div><strong>{f.scenario}</strong> › {f.step}</div>
              <div className="erro">{f.error.split("\n")[0]}</div>
              <div className="links">
                Pacote para o dev:{" "}
                <a href={url(r.reportId ?? "", `${f.dir}/falha.md`)} target="_blank" rel="noreferrer">falha.md</a> ·{" "}
                <a href={url(r.reportId ?? "", `${f.dir}/falha.json`)} target="_blank" rel="noreferrer">falha.json</a>
                {f.jira && (
                  <>
                    {" · "}Jira:{" "}
                    <a href={f.jira.url} target="_blank" rel="noreferrer">{f.jira.key}</a>{" "}
                    <span className="tag">{f.jira.action === "created" ? "card criado" : "comentado (falha repetida)"}</span>
                  </>
                )}
              </div>
            </div>
          ))}
        </article>
      ))}
    </div>
  );
}

const css = `
.qrep { --r-line: var(--line, #dcdce2); --r-muted: var(--muted, #6b6b75); --r-ok: var(--ok, #15803d); --r-fail: var(--fail, #b91c1c); --r-card: var(--card, #fff); }
.qrep h1 { margin: 0 0 4px; font-size: 22px; }
.qrep .cab { display: flex; justify-content: space-between; align-items: end; gap: 12px; flex-wrap: wrap; margin-bottom: 16px; }
.qrep .acoes { display: flex; gap: 8px; }
.qrep .sub { color: var(--r-muted); font-size: 14px; margin: 0; }
.qrep .run { background: var(--r-card); border: 1px solid var(--r-line); border-left: 4px solid var(--r-ok); border-radius: 8px; padding: 12px 14px; margin-bottom: 10px; }
.qrep .run.failed, .qrep .run.error { border-left-color: var(--r-fail); }
.qrep .linha { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
.qrep .abrir { margin-left: auto; }
.qrep .selo { font-size: 11px; font-weight: 700; text-transform: uppercase; padding: 1px 8px; border-radius: 99px; border: 1px solid currentColor; }
.qrep .passed { color: var(--r-ok); } .qrep .failed, .qrep .error { color: var(--r-fail); }
.qrep .falha { margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--r-line); font-size: 14px; }
.qrep .falha .erro { color: var(--r-fail); font-family: ui-monospace, Menlo, monospace; font-size: 12.5px; margin: 2px 0; }
.qrep .falha .links { color: var(--r-muted); font-size: 13px; }
.qrep .tag { font-size: 11px; padding: 1px 6px; border-radius: 4px; border: 1px solid var(--r-line); }
`;
