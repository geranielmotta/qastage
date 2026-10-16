// CSS do painel, embutido no componente: o remote não depende de o host
// carregar o CSS dele. Usa as variáveis do shell quando existem.
export const css = `
.qui { --q-line: var(--line, #dcdce2); --q-muted: var(--muted, #6b6b75); --q-ok: var(--ok, #15803d);
  --q-fail: var(--fail, #b91c1c); --q-skip: var(--skip, #8a8a94); --q-card: var(--card, #fff); --q-accent: var(--accent, #2563eb); }
.qui h1 { margin: 0 0 4px; font-size: 22px; }
.qui .sub { color: var(--q-muted); margin: 0 0 16px; font-size: 14px; }
.qui .abas { display: flex; gap: 4px; border-bottom: 1px solid var(--q-line); margin-bottom: 16px; }
.qui .abas button { border: 0; border-bottom: 2px solid transparent; border-radius: 0; background: none; padding: 8px 12px; }
.qui .abas button.ativa { border-bottom-color: var(--q-accent); font-weight: 600; }
.qui .linha { display: flex; gap: 12px; flex-wrap: wrap; align-items: end; margin-bottom: 12px; }
.qui .linha label { display: flex; flex-direction: column; gap: 4px; font-size: 13px; color: var(--q-muted); }
.qui textarea { width: 100%; min-height: 280px; font-family: ui-monospace, Menlo, monospace; font-size: 13px; line-height: 1.5; }
.qui .primario { background: var(--q-accent); color: #fff; border-color: var(--q-accent); padding: 7px 16px; }
.qui .primario:disabled { opacity: .6; cursor: wait; }
.qui .card { background: var(--q-card); border: 1px solid var(--q-line); border-radius: 8px; padding: 14px; margin-top: 16px; }
.qui .card h2 { font-size: 15px; margin: 0 0 10px; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.qui .relatorio { margin-left: auto; font-weight: 400; font-size: 14px; }
.qui .status { font-weight: 700; text-transform: uppercase; font-size: 12px; padding: 2px 8px; border-radius: 99px; border: 1px solid currentColor; }
.qui .passed { color: var(--q-ok); } .qui .failed, .qui .error { color: var(--q-fail); } .qui .skipped { color: var(--q-skip); }
.qui ul.passos { list-style: none; padding: 0; margin: 0; font-size: 14px; }
.qui ul.passos li { padding: 3px 0; }
.qui pre { white-space: pre-wrap; background: color-mix(in srgb, var(--q-fail) 8%, transparent); padding: 10px; border-radius: 6px; font-size: 12px; overflow-x: auto; }
.qui pre.log { background: color-mix(in srgb, var(--q-line) 40%, transparent); max-height: 240px; overflow: auto; }
.qui table { border-collapse: collapse; width: 100%; font-size: 13px; }
.qui th, .qui td { text-align: left; padding: 5px 8px; border-bottom: 1px solid var(--q-line); vertical-align: top; }
.qui code { font-family: ui-monospace, Menlo, monospace; font-size: 12px; }
.qui .tag { font-size: 11px; padding: 1px 6px; border-radius: 4px; border: 1px solid var(--q-line); white-space: nowrap; }
.qui .prints { display: flex; gap: 12px; flex-wrap: wrap; }
.qui .prints a { display: block; width: 240px; font-size: 12px; color: var(--q-muted); text-decoration: none; }
.qui .prints img { width: 100%; border: 1px solid var(--q-line); border-radius: 6px; }
.qui .tabela { overflow-x: auto; }
.qui .editor { display: flex; gap: 12px; align-items: stretch; }
.qui .editor textarea { flex: 1; min-width: 0; }
.qui .vocab { width: 300px; flex-shrink: 0; display: flex; flex-direction: column; gap: 4px; max-height: 360px; overflow: auto; font-size: 13px; }
.qui .vocab small { color: var(--q-muted); margin-bottom: 4px; }
.qui .vocab button { text-align: left; padding: 4px 8px; }
.qui .excecao { border: 1px solid var(--q-fail); border-radius: 8px; padding: 12px; margin-top: 12px; font-size: 14px; }
.qui .excecao p { margin: 4px 0; }
.qui .excecao ul { margin: 4px 0 10px; padding-left: 20px; font-size: 13px; }
.qui .linha label.check { flex-direction: row; align-items: center; color: inherit; }
@media (max-width: 800px) { .qui .editor { flex-direction: column; } .qui .vocab { width: auto; max-height: 200px; } }
`;
