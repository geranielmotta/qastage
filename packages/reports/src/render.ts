import type { Artifact, FailureReport, RunStatus } from "@qastage/core-contract";
import type { RunReport } from "./types";

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const ICONE: Record<RunStatus, string> = { passed: "✓", failed: "✗", error: "✗", skipped: "–" };
const ROTULO: Record<RunStatus, string> = { passed: "passou", failed: "falhou", error: "erro", skipped: "pulado" };

const ms = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)} s` : `${n} ms`);
const quando = (iso: string) => new Date(iso).toLocaleString("pt-BR");

function link(a: Artifact): string {
  return `<a href="${esc(a.path)}" target="_blank" rel="noopener">${esc(a.label ?? a.path)}</a>`;
}

function thumbs(list: Artifact[] = []): string {
  const imgs = list.filter((a) => a.kind === "screenshot");
  if (!imgs.length) return "";
  return `<div class="thumbs">${imgs
    .map((a) => `<a href="${esc(a.path)}" target="_blank" rel="noopener"><img loading="lazy" src="${esc(a.path)}" alt="${esc(a.label)}"></a>`)
    .join("")}</div>`;
}

function dataTable(data: Record<string, string>): string {
  const linhas = Object.entries(data);
  if (!linhas.length) return "<p class=muted>Nenhum dado preenchido antes da falha.</p>";
  return `<table><tbody>${linhas.map(([k, v]) => `<tr><th>${esc(k)}</th><td><code>${esc(v)}</code></td></tr>`).join("")}</tbody></table>`;
}

/** report.html: estático e autocontido (CSS embutido, links relativos). */
export function renderHtml(r: RunReport): string {
  const falhas = r.failures
    .map(
      (f) => `
    <section class="falha" id="falha-${esc(f.dir)}">
      <h3>✗ ${esc(f.scenario)}</h3>
      <p><strong>Passo:</strong> ${esc(f.step)}</p>
      ${f.url ? `<p><strong>Tela:</strong> <a href="${esc(f.url)}">${esc(f.url)}</a></p>` : ""}
      <pre class="erro">${esc(f.error)}</pre>
      <div class="grade">
        <div>
          <h4>Como reproduzir</h4>
          <ol>${f.stepsToReproduce.map((s) => `<li>${esc(s)}</li>`).join("")}</ol>
          <h4>Dados usados</h4>
          ${dataTable(f.data)}
        </div>
        <div>${thumbs(f.artifacts)}</div>
      </div>
      ${f.console?.length ? `<h4>Console e rede do alvo</h4><pre class="log">${esc(f.console.join("\n"))}</pre>` : ""}
      <p class="arquivos"><strong>Arquivos:</strong> ${f.artifacts.filter((a) => a.kind !== "screenshot").map(link).join(" · ")}
        · <a href="${esc(f.dir)}/falha.md" target="_blank" rel="noopener">falha.md</a>
        · <a href="${esc(f.dir)}/falha.json" target="_blank" rel="noopener">falha.json</a></p>
    </section>`,
    )
    .join("");

  const cenarios = r.scenarios
    .map(
      (sc) => `
    <details class="cenario ${sc.status}" ${sc.status !== "passed" ? "open" : ""}>
      <summary><span class="st ${sc.status}">${ICONE[sc.status]}</span> ${esc(sc.name)}
        <small>${sc.steps.length} passos</small></summary>
      <ol class="passos">${sc.steps
        .map(
          (s) => `
        <li class="${s.status}">
          <div class="passo"><span class="st ${s.status}">${ICONE[s.status]}</span>
            <span>${esc(s.scenario ? s.name.replace(`${s.scenario} › `, "") : s.name)}</span>
            ${s.status !== "skipped" ? `<small>${ms(s.durationMs)}</small>` : ""}</div>
          ${s.error ? `<pre class="erro">${esc(s.error)}</pre>` : ""}
          ${thumbs(s.artifacts)}
        </li>`,
        )
        .join("")}
      </ol>
    </details>`,
    )
    .join("");

  const outros = r.artifacts.filter((a) => a.kind !== "screenshot");

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Relatório ${esc(r.plugin)} — ${esc(ROTULO[r.status])}</title>
<style>
:root { --bg:#f7f7f8; --fg:#1c1c1f; --muted:#6b6b75; --line:#dcdce2; --card:#fff; --ok:#15803d; --fail:#b91c1c; --skip:#8a8a94; --accent:#2563eb; color-scheme: light; }
@media (prefers-color-scheme: dark) { :root { --bg:#141417; --fg:#ececf0; --muted:#9a9aa5; --line:#2e2e35; --card:#1c1c21; --ok:#4ade80; --fail:#f87171; --accent:#6b9bff; color-scheme: dark; } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg); font: 15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
main { max-width: 1100px; margin: 0 auto; padding: 24px 16px 48px; }
h1 { margin: 0; font-size: 24px; } h2 { font-size: 18px; margin: 28px 0 10px; } h3 { margin: 0 0 8px; font-size: 16px; } h4 { margin: 14px 0 6px; font-size: 14px; }
a { color: var(--accent); }
.muted, small { color: var(--muted); }
.topo { display: flex; justify-content: space-between; align-items: center; gap: 16px; flex-wrap: wrap; }
.selo { font-weight: 700; text-transform: uppercase; font-size: 13px; padding: 3px 12px; border-radius: 99px; border: 1.5px solid currentColor; }
.meta { display: flex; flex-wrap: wrap; gap: 8px 24px; margin: 12px 0 0; padding: 0; list-style: none; color: var(--muted); font-size: 14px; }
.meta strong { color: var(--fg); font-weight: 600; }
.passed { color: var(--ok); } .failed, .error { color: var(--fail); } .skipped { color: var(--skip); }
.falha, .cenario { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 14px 16px; margin-bottom: 12px; }
.falha { border-color: var(--fail); }
.falha h3 { color: var(--fail); }
.grade { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 16px; }
@media (max-width: 720px) { .grade { grid-template-columns: 1fr; } }
pre { white-space: pre-wrap; overflow-x: auto; border-radius: 6px; padding: 10px; font-size: 12.5px; margin: 8px 0; }
pre.erro { background: color-mix(in srgb, var(--fail) 9%, transparent); color: var(--fg); }
pre.log { background: color-mix(in srgb, var(--line) 45%, transparent); max-height: 260px; }
table { border-collapse: collapse; font-size: 14px; } th, td { text-align: left; padding: 4px 12px 4px 0; border-bottom: 1px solid var(--line); vertical-align: top; }
code { font-family: ui-monospace, Menlo, monospace; font-size: 12.5px; }
summary { cursor: pointer; font-weight: 600; color: var(--fg); }
summary small { font-weight: 400; margin-left: 6px; }
.passos { list-style: none; padding: 0; margin: 10px 0 0; }
.passos > li { padding: 8px 0; border-top: 1px solid var(--line); color: var(--fg); }
.passo { display: flex; gap: 8px; align-items: baseline; }
.passo small { margin-left: auto; white-space: nowrap; }
.st { font-weight: 700; width: 1em; display: inline-block; }
.thumbs { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 8px; }
.thumbs img { width: 220px; max-width: 100%; border: 1px solid var(--line); border-radius: 6px; display: block; }
.arquivos { font-size: 14px; }
</style>
</head>
<body>
<main>
  <div class="topo">
    <h1>${esc(r.plugin)}</h1>
    <span class="selo ${r.status}">${ICONE[r.status]} ${esc(ROTULO[r.status])}</span>
  </div>
  <ul class="meta">
    <li>Ambiente <strong>${esc(r.env.name)}</strong> · ${esc(r.env.baseUrl)}</li>
    <li>Início <strong>${esc(quando(r.startedAt))}</strong></li>
    <li>Duração <strong>${ms(r.durationMs)}</strong></li>
    <li><span class="passed">${r.counts.passed} passaram</span> · <span class="failed">${r.counts.failed + r.counts.error} falharam</span> · <span class="skipped">${r.counts.skipped} pulados</span></li>
  </ul>
  ${r.error && !r.failures.length ? `<pre class="erro">${esc(r.error)}</pre>` : ""}
  ${
    r.metrics
      ? `<h2>Métricas</h2><div class="cenario"><table><tbody>${Object.entries(r.metrics)
          .map(([k, v]) => `<tr><th>${esc(k)}</th><td><code>${esc(v.toLocaleString("pt-BR"))}</code></td></tr>`)
          .join("")}</tbody></table></div>`
      : ""
  }
  ${r.failures.length ? `<h2>Falhas (${r.failures.length})</h2>${falhas}` : ""}
  ${cenarios ? `<h2>Cenários</h2>${cenarios}` : ""}
  ${outros.length ? `<h2>Outros arquivos</h2><p>${outros.map(link).join(" · ")}</p>` : ""}
  ${r.logs.length ? `<details class="cenario"><summary>Log do runner</summary><pre class="log">${esc(r.logs.join("\n"))}</pre></details>` : ""}
</main>
</body>
</html>
`;
}

/** falha.md: o pacote em texto, pronto para colar num card ou mandar ao dev. */
export function renderFailureMarkdown(
  f: FailureReport,
  meta: { plugin: string; env: { name: string; baseUrl: string }; startedAt: string },
): string {
  const linhas = [
    `# Falha: ${f.scenario}`,
    "",
    `- **Plugin:** ${meta.plugin}`,
    `- **Ambiente:** ${meta.env.name} (${meta.env.baseUrl})`,
    `- **Quando:** ${meta.startedAt}`,
    ...(f.url ? [`- **Tela:** ${f.url}`] : []),
    `- **Passo que falhou:** ${f.step}`,
    "",
    "## Erro",
    "",
    "```",
    f.error,
    "```",
    "",
    "## Como reproduzir",
    "",
    ...f.stepsToReproduce.map((s, i) => `${i + 1}. ${s}`),
    "",
    "## Dados usados",
    "",
    ...(Object.keys(f.data).length
      ? ["| Campo | Valor |", "| --- | --- |", ...Object.entries(f.data).map(([k, v]) => `| ${k} | \`${v}\` |`)]
      : ["Nenhum dado preenchido antes da falha."]),
    "",
  ];
  if (f.console?.length) linhas.push("## Console e rede do alvo", "", "```", ...f.console, "```", "");
  if (f.artifacts.length) linhas.push("## Arquivos", "", ...f.artifacts.map((a) => `- [${a.label ?? a.path}](${a.path})`), "");
  return linhas.join("\n");
}
