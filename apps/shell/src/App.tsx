import type { PanelProps, PluginManifest, WebRemote } from "@qastage/core-contract";
import { Component, useEffect, useState, type ComponentType, type ReactNode } from "react";
import { loadEnvs, saveEnvs } from "./environments";
import { loadPanel } from "./remotes";

const API = import.meta.env.VITE_QASTAGE_API ?? "http://localhost:4000";

type ComPainel = PluginManifest & { webRemote: WebRemote };

function useHashRoute(): string {
  const [rota, setRota] = useState(() => location.hash.slice(1) || "/");
  useEffect(() => {
    const on = () => setRota(location.hash.slice(1) || "/");
    addEventListener("hashchange", on);
    return () => removeEventListener("hashchange", on);
  }, []);
  return rota;
}

export function App() {
  const rota = useHashRoute();
  const [plugins, setPlugins] = useState<PluginManifest[] | null>(null);
  const [erroApi, setErroApi] = useState<string | null>(null);
  const [envs, setEnvs] = useState(loadEnvs);
  const [envName, setEnvName] = useState(() => envs[0]?.name ?? "local");
  const env = envs.find((e) => e.name === envName) ?? envs[0]!;

  useEffect(() => {
    fetch(`${API}/api/plugins`)
      .then((r) => r.json() as Promise<PluginManifest[]>)
      .then(setPlugins)
      .catch(() => setErroApi(`Runner fora do ar em ${API}. Suba com: pnpm --filter @qastage/runner dev`));
  }, []);

  const comPainel = (plugins ?? []).filter((p): p is ComPainel => !!p.webRemote);
  const atual = comPainel.find((p) => p.webRemote.route === rota);

  const editarBaseUrl = (baseUrl: string) => {
    const novos = envs.map((e) => (e.name === env.name ? { ...e, baseUrl } : e));
    setEnvs(novos);
    saveEnvs(novos);
  };

  return (
    <div className="shell">
      <header className="topo">
        <a href="#/" className="marca">QAStage</a>
        <label className="env">
          Ambiente
          <select value={env.name} onChange={(e) => setEnvName(e.target.value)}>
            {envs.map((e) => <option key={e.name}>{e.name}</option>)}
          </select>
          <input value={env.baseUrl} onChange={(e) => editarBaseUrl(e.target.value)} aria-label="URL base do ambiente" />
        </label>
      </header>
      <div className="corpo">
        <nav className="menu">
          {comPainel.map((p) => (
            <a key={p.name} href={`#${p.webRemote.route}`} className={p === atual ? "ativo" : ""}>
              {p.webRemote.title}
            </a>
          ))}
        </nav>
        <main className="conteudo">
          {erroApi && <p className="erro">{erroApi}</p>}
          {!erroApi && !plugins && <p>Carregando plugins…</p>}
          {plugins && !atual && <Inicio plugins={plugins} />}
          {atual && (
            <Limite key={atual.name} nome={atual.webRemote.title}>
              <PainelRemoto remote={atual.webRemote} props={{ apiBase: API, env }} />
            </Limite>
          )}
        </main>
      </div>
    </div>
  );
}

function Inicio({ plugins }: { plugins: PluginManifest[] }) {
  return (
    <>
      <h1>Plugins</h1>
      <ul className="catalogo">
        {plugins.map((p) => (
          <li key={p.name}>
            {p.webRemote ? <a href={`#${p.webRemote.route}`}>{p.webRemote.title}</a> : <strong>{p.name}</strong>}
            <span> — {p.description ?? "sem descrição"}</span>
            {!p.webRemote && <em> (só runner, sem painel)</em>}
          </li>
        ))}
      </ul>
    </>
  );
}

function PainelRemoto({ remote, props }: { remote: WebRemote; props: PanelProps }) {
  const [Painel, setPainel] = useState<ComponentType<PanelProps> | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  useEffect(() => {
    loadPanel(remote)
      .then((c) => setPainel(() => c))
      .catch((e: Error) => setErro(`Não carreguei o painel de ${remote.entry}: ${e.message}`));
  }, [remote]);
  if (erro) return <p className="erro">{erro}</p>;
  return Painel ? <Painel {...props} /> : <p>Carregando painel…</p>;
}

/** Um painel quebrado não derruba o shell. */
class Limite extends Component<{ nome: string; children: ReactNode }, { erro?: string }> {
  state: { erro?: string } = {};
  static getDerivedStateFromError(e: Error) {
    return { erro: e.message };
  }
  render() {
    return this.state.erro ? <p className="erro">Painel "{this.props.nome}" falhou: {this.state.erro}</p> : this.props.children;
  }
}
