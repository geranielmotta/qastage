// CSS embutido no painel: o remote não depende de o host carregar o CSS dele.
export const css = `
.qload { --l-line: var(--line, #dcdce2); --l-muted: var(--muted, #6b6b75); --l-ok: var(--ok, #15803d);
  --l-fail: var(--fail, #b91c1c); --l-skip: var(--skip, #8a8a94); --l-card: var(--card, #fff); --l-accent: var(--accent, #2563eb); }
.qload h1 { margin: 0 0 4px; font-size: 22px; }
.qload .sub { color: var(--l-muted); font-size: 14px; margin: 0 0 16px; }
.qload .linha { display: flex; gap: 12px; flex-wrap: wrap; align-items: end; margin-bottom: 12px; }
.qload .linha label { display: flex; flex-direction: column; gap: 4px; font-size: 13px; color: var(--l-muted); }
.qload textarea { width: 100%; min-height: 360px; font-family: ui-monospace, Menlo, monospace; font-size: 13px; line-height: 1.5; }
.qload .primario { background: var(--l-accent); color: #fff; border-color: var(--l-accent); padding: 7px 16px; }
.qload .primario:disabled { opacity: .6; cursor: wait; }
.qload .card { background: var(--l-card); border: 1px solid var(--l-line); border-radius: 8px; padding: 14px; margin-top: 16px; }
.qload .card h2 { font-size: 15px; margin: 0 0 12px; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.qload .relatorio { margin-left: auto; font-weight: 400; font-size: 14px; }
.qload .status { font-weight: 700; text-transform: uppercase; font-size: 12px; padding: 2px 8px; border-radius: 99px; border: 1px solid currentColor; }
.qload .passed { color: var(--l-ok); } .qload .failed, .qload .error { color: var(--l-fail); } .qload .skipped { color: var(--l-skip); }
.qload .metricas { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 8px; margin-bottom: 14px; }
.qload .metrica { border: 1px solid var(--l-line); border-radius: 8px; padding: 10px; display: flex; flex-direction: column; gap: 2px; }
.qload .metrica .valor { font-size: 20px; font-weight: 700; font-variant-numeric: tabular-nums; }
.qload .metrica .nome { font-size: 12px; color: var(--l-muted); }
.qload ul.passos { list-style: none; padding: 0; margin: 0; font-size: 14px; }
.qload ul.passos li { padding: 3px 0; }
.qload pre { white-space: pre-wrap; padding: 10px; border-radius: 6px; font-size: 12px; color: var(--fg, inherit); }
.qload pre.erro { background: color-mix(in srgb, var(--l-fail) 8%, transparent); }
.qload pre.log { background: color-mix(in srgb, var(--l-line) 40%, transparent); max-height: 240px; overflow: auto; }
.qload .arquivos { display: flex; gap: 14px; flex-wrap: wrap; font-size: 13px; margin: 12px 0 0; }
`;
