import type { PanelProps, PluginManifest, WebRemote } from "@qastage/core-contract";
import { Component, useEffect, useState, type ComponentType, type ReactNode } from "react";
import { loadEnvs, saveEnvs, type Env } from "./environments";
import { loadPanel } from "./remotes";

const API = import.meta.env.VITE_QASTAGE_API ?? "http://localhost:4000";

type ComPainel = PluginManifest & { webRemote: WebRemote };

/** GET /api/config: ambientes já resolvidos pelo runner a partir do qastage.config.json. */
interface ConfigDoProjeto {
  projeto: string;
  padrao: string;
  ambientes: Array<Required<Pick<Env, "name" | "baseUrl">> & Env>;
  plugins: Record<string, Record<string, string | number | boolean>>;
}

const CHAVE_ENV = "qastage.env";
const lerEnvEscolhido = () => {
  try {
    return localStorage.getItem(CHAVE_ENV);
  } catch {
    return null;
  }
};
const salvarEnvEscolhido = (n: string) => {
  try {
    localStorage.setItem(CHAVE_ENV, n);
  } catch {
    /* sem storage */
  }
};

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
  // Com qastage.config.json os ambientes vêm do runner (iguais para o time todo);
  // sem config, cai nos ambientes locais editáveis (localStorage).
  const [config, setConfig] = useState<ConfigDoProjeto | null | undefined>(undefined);
  const [envsLocais, setEnvsLocais] = useState(loadEnvs);
  const envs: Env[] = config ? config.ambientes : envsLocais;
  const [envName, setEnvName] = useState<string | null>(lerEnvEscolhido);
  const env = envs.find((e) => e.name === envName) ?? envs.find((e) => e.name === config?.padrao) ?? envs[0]!;

  useEffect(() => {
    fetch(`${API}/api/plugins`)
      .then((r) => r.json() as Promise<PluginManifest[]>)
      .then(setPlugins)
      .catch(() => setErroApi(`Runner fora do ar em ${API}. Suba com: pnpm --filter @qastage/runner dev`));
    fetch(`${API}/api/config`)
      .then(async (r) => {
        if (r.status === 404) return null;
        const body = (await r.json()) as ConfigDoProjeto & { error?: string };
        if (!r.ok) throw new Error(body.error);
        return body;
      })
      .then(setConfig)
      .catch((e: Error) => {
        setConfig(null);
        if (e.message) setErroApi(`Config do projeto com erro:\n${e.message}`);
      });
  }, []);

  const comPainel = (plugins ?? []).filter((p): p is ComPainel => !!p.webRemote);
  const atual = comPainel.find((p) => p.webRemote.route === rota);

  const escolher = (n: string) => {
    setEnvName(n);
    salvarEnvEscolhido(n);
  };
  const editarBaseUrl = (baseUrl: string) => {
    const novos = envsLocais.map((e) => (e.name === env.name ? { ...e, baseUrl } : e));
    setEnvsLocais(novos);
    saveEnvs(novos);
  };

  return (
    <div className="shell">
      <header className="topo">
        <a href="#/" className="marca">
          QAStage{config && <span className="projeto"> · {config.projeto}</span>}
        </a>
        <label className="env">
          Ambiente
          <select value={env.name} onChange={(e) => escolher(e.target.value)}>
            {envs.map((e) => <option key={e.name}>{e.name}</option>)}
          </select>
          {config ? (
            <span className="urls" title="Definido no qastage.config.json">
              {env.baseUrl}
              {env.apiUrl && env.apiUrl !== env.baseUrl && <> · API {env.apiUrl}</>}
              <span className={`selo ${env.writable ? "" : "aviso"}`}>{env.writable ? "escrita" : "só leitura"}</span>
              {env.allowLoad && <span className="selo">carga</span>}
            </span>
          ) : (
            config === null && <input value={env.baseUrl} onChange={(e) => editarBaseUrl(e.target.value)} aria-label="URL base do ambiente" />
          )}
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
          {!erroApi && (!plugins || config === undefined) && <p>Carregando…</p>}
          {plugins && config !== undefined && !atual && <Inicio plugins={plugins} semConfig={config === null} />}
          {atual && config !== undefined && (
            <Limite key={atual.name} nome={atual.webRemote.title}>
              <PainelRemoto
                remote={atual.webRemote}
                props={{ apiBase: API, env, ...(config?.plugins[atual.name] ? { defaults: config.plugins[atual.name] } : {}) }}
              />
            </Limite>
          )}
        </main>
      </div>
    </div>
  );
}

function Inicio({ plugins, semConfig }: { plugins: PluginManifest[]; semConfig: boolean }) {
  return (
    <>
      {semConfig && (
        <p className="aviso-config">
          Sem <code>qastage.config.json</code> na raiz do projeto: os ambientes ficam só neste navegador. Crie o arquivo
          para o time inteiro usar as mesmas URLs e regras (escrita, carga).
        </p>
      )}
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
