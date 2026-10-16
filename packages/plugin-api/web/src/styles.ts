// CSS embutido no painel: o remote não depende de o host carregar o CSS dele.
export const css = `
.qapi { --a-line: var(--line, #dcdce2); --a-muted: var(--muted, #6b6b75); --a-ok: var(--ok, #15803d);
  --a-fail: var(--fail, #b91c1c); --a-skip: var(--skip, #8a8a94); --a-card: var(--card, #fff); --a-accent: var(--accent, #2563eb); }
.qapi h1 { margin: 0 0 4px; font-size: 22px; }
.qapi .sub { color: var(--a-muted); font-size: 13px; margin: 0; }
.qapi > .sub { margin-bottom: 16px; font-size: 14px; }
.qapi .linha { display: flex; gap: 12px; flex-wrap: wrap; align-items: end; margin-bottom: 12px; }
.qapi .linha label { display: flex; flex-direction: column; gap: 4px; font-size: 13px; color: var(--a-muted); }
.qapi .linha .cresce { flex: 1; min-width: 240px; }
.qapi .grade { display: grid; grid-template-columns: minmax(260px, 340px) minmax(0, 1fr); gap: 16px; }
@media (max-width: 860px) { .qapi .grade { grid-template-columns: 1fr; } }
.qapi .catalogo { max-height: 520px; overflow: auto; display: flex; flex-direction: column; gap: 8px; }
.qapi .ep { background: var(--a-card); border: 1px solid var(--a-line); border-radius: 8px; padding: 8px 10px; }
.qapi .ep-linha { display: flex; gap: 8px; align-items: center; }
.qapi .ep-linha code { font-family: ui-monospace, Menlo, monospace; font-size: 13px; word-break: break-all; }
.qapi .ep-acoes { display: flex; gap: 6px; margin-top: 6px; }
.qapi .ep-acoes button { font-size: 12px; padding: 2px 8px; }
.qapi .metodo { font: 700 11px ui-monospace, Menlo, monospace; padding: 2px 6px; border-radius: 4px; color: #fff; background: #6b7280; }
.qapi .m-get { background: #2563eb; } .qapi .m-post { background: #15803d; } .qapi .m-put, .qapi .m-patch { background: #b45309; } .qapi .m-delete { background: #b91c1c; }
.qapi .editor { display: flex; flex-direction: column; gap: 10px; align-items: flex-start; }
.qapi textarea { width: 100%; min-height: 440px; font-family: ui-monospace, Menlo, monospace; font-size: 13px; line-height: 1.5; }
.qapi .primario { background: var(--a-accent); color: #fff; border-color: var(--a-accent); padding: 7px 16px; }
.qapi .primario:disabled { opacity: .6; cursor: wait; }
.qapi .card { background: var(--a-card); border: 1px solid var(--a-line); border-radius: 8px; padding: 14px; margin-top: 16px; }
.qapi .card h2 { font-size: 15px; margin: 0 0 10px; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.qapi .relatorio { margin-left: auto; font-weight: 400; font-size: 14px; }
.qapi .status { font-weight: 700; text-transform: uppercase; font-size: 12px; padding: 2px 8px; border-radius: 99px; border: 1px solid currentColor; }
.qapi .passed { color: var(--a-ok); } .qapi .failed, .qapi .error { color: var(--a-fail); } .qapi .skipped { color: var(--a-skip); }
.qapi ul.passos { list-style: none; padding: 0; margin: 0; font-size: 14px; }
.qapi ul.passos li { padding: 4px 0; }
.qapi .trocas { display: flex; flex-wrap: wrap; gap: 4px 12px; margin: 2px 0 0 18px; font-size: 12px; }
.qapi pre { white-space: pre-wrap; padding: 10px; border-radius: 6px; font-size: 12px; overflow-x: auto; color: var(--fg, inherit); }
.qapi pre.erro { background: color-mix(in srgb, var(--a-fail) 8%, transparent); }
.qapi pre.aviso { background: color-mix(in srgb, var(--a-skip) 12%, transparent); }
.qapi pre.log { background: color-mix(in srgb, var(--a-line) 40%, transparent); max-height: 240px; overflow: auto; }
`;
