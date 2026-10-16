import type { PanelProps, PluginManifest, WebRemote } from "@qastage/core-contract";
import { Component, useEffect, useState, type ComponentType, type ReactNode } from "react";
import { Admin } from "./Admin";
import { API, enviar, envEscolhido, getJson, type ComPainel, type Projeto, type ProjetoResumo, type Usuario } from "./api";
import { Entrar, TrocarSenha } from "./Auth";
import { Dashboard } from "./Dashboard";
import { ProjectHome } from "./ProjectHome";
import { loadPanel } from "./remotes";

/** "#/p/portal/api?arquivo=features/api/x.feature" → { projeto, rota, arquivo } */
function useHashRoute() {
  const ler = () => {
    const [caminho, query] = (location.hash.slice(1) || "/").split("?");
    const m = caminho!.match(/^\/p\/([\w-]+)(\/.*)?$/);
    return {
      projeto: m?.[1],
      rota: m ? (m[2] ?? "/") : caminho!,
      arquivo: new URLSearchParams(query ?? "").get("arquivo") ?? undefined,
    };
  };
  const [r, setR] = useState(ler);
  useEffect(() => {
    const on = () => setR(ler());
    addEventListener("hashchange", on);
    return () => removeEventListener("hashchange", on);
  }, []);
  return r;
}

type Sessao = { usuario: Usuario } | { usuario: null; setup: boolean } | undefined;

export function App() {
  const [sessao, setSessao] = useState<Sessao>(undefined);
  const [erroApi, setErroApi] = useState<string | null>(null);

  const verificar = () =>
    fetch(`${API}/api/auth/me`, { credentials: "include" })
      .then(async (r) => {
        const b = (await r.json()) as { usuario?: Usuario; setup?: boolean };
        setSessao(b.usuario ? { usuario: b.usuario } : { usuario: null, setup: !!b.setup });
      })
      .catch(() => setErroApi(`Runner fora do ar em ${API}. Suba com: pnpm --filter @qastage/runner dev`));

  useEffect(() => {
    void verificar();
    const expirou = () => setSessao({ usuario: null, setup: false });
    addEventListener("qastage:sessao-expirada", expirou);
    return () => removeEventListener("qastage:sessao-expirada", expirou);
  }, []);

  if (erroApi) return <p className="erro conteudo">{erroApi}</p>;
  if (!sessao) return <p className="conteudo">Carregando…</p>;
  if (!sessao.usuario) return <Entrar setup={sessao.setup} onEntrou={(u) => setSessao({ usuario: u })} />;
  return <Logado usuario={sessao.usuario} onSair={() => setSessao({ usuario: null, setup: false })} />;
}

/** Nome, troca de senha, administração e saída — no canto do cabeçalho. */
function MenuUsuario({ usuario, onSair }: { usuario: Usuario; onSair: () => void }) {
  const [aberto, setAberto] = useState(false);
  const [trocando, setTrocando] = useState(false);
  const sair = async () => {
    await enviar("/api/auth/logout", "POST").catch(() => undefined);
    onSair();
  };
  return (
    <div className="usuario">
      <button className="usuario-botao" onClick={() => setAberto((v) => !v)} aria-expanded={aberto}>
        {usuario.nome} <span className="papel">{usuario.papel === "admin" ? "admin" : "QA"}</span> ▾
      </button>
      {aberto && (
        <div className="usuario-menu" onClick={() => setAberto(false)}>
          {usuario.papel === "admin" && <a href="#/admin">Administração</a>}
          <button onClick={() => setTrocando(true)}>Trocar senha</button>
          <button onClick={() => void sair()}>Sair</button>
        </div>
      )}
      {trocando && <TrocarSenha onFechar={() => setTrocando(false)} />}
    </div>
  );
}

function Logado({ usuario, onSair }: { usuario: Usuario; onSair: () => void }) {
  const { projeto: projetoId, rota, arquivo } = useHashRoute();
  const [plugins, setPlugins] = useState<PluginManifest[] | null>(null);
  const [erroApi, setErroApi] = useState<string | null>(null);
  const menu = <MenuUsuario usuario={usuario} onSair={onSair} />;

  useEffect(() => {
    getJson<PluginManifest[]>("/api/plugins")
      .then(setPlugins)
      .catch((e: Error) => setErroApi(e.message));
  }, []);

  const topoSimples = (
    <header className="topo">
      <a href="#/" className="marca">QAStage</a>
      {menu}
    </header>
  );

  return (
    <div className="shell">
      {erroApi ? (
        <>
          {topoSimples}
          <p className="erro conteudo">{erroApi}</p>
        </>
      ) : !plugins ? (
        <p className="conteudo">Carregando…</p>
      ) : projetoId ? (
        <AreaDoProjeto key={projetoId} id={projetoId} rota={rota} arquivo={arquivo} plugins={plugins} menu={menu} />
      ) : (
        <>
          {topoSimples}
          <main className="conteudo">
            {rota === "/admin" ? (
              usuario.papel === "admin" ? <Admin eu={usuario} /> : <p className="erro">Só administradores.</p>
            ) : (
              <Dashboard admin={usuario.papel === "admin"} />
            )}
          </main>
        </>
      )}
    </div>
  );
}

/** Dentro de um projeto: cabeçalho com troca de projeto/ambiente, menu dos painéis, conteúdo. */
function AreaDoProjeto({ id, rota, arquivo, plugins, menu }: { id: string; rota: string; arquivo?: string; plugins: PluginManifest[]; menu: ReactNode }) {
  const [projeto, setProjeto] = useState<Projeto | null>(null);
  const [todos, setTodos] = useState<ProjetoResumo[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [envName, setEnvName] = useState<string | null>(() => envEscolhido.get(id));

  useEffect(() => {
    getJson<Projeto>(`/api/projects/${id}`).then(setProjeto).catch((e: Error) => setErro(e.message));
    getJson<ProjetoResumo[]>("/api/projects").then(setTodos).catch(() => setTodos([]));
  }, [id]);

  const paineis = plugins.filter((p): p is ComPainel => !!p.webRemote);
  const atual = paineis.find((p) => p.webRemote.route === rota);
  const env = projeto ? (projeto.ambientes.find((a) => a.name === envName) ?? projeto.ambientes.find((a) => a.name === projeto.padrao) ?? projeto.ambientes[0]!) : null;

  const escolherEnv = (n: string) => {
    setEnvName(n);
    envEscolhido.set(id, n);
  };

  return (
    <>
      <header className="topo">
        <div className="trilha">
          <a href="#/" className="marca">QAStage</a>
          <span className="sep">/</span>
          <select className="proj-select" value={id} onChange={(e) => (location.hash = `#/p/${e.target.value}`)} aria-label="Projeto">
            {(todos.length ? todos : [{ id, name: projeto?.name ?? id }]).map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
        {env && projeto && (
          <label className="env">
            Ambiente
            <select value={env.name} onChange={(e) => escolherEnv(e.target.value)}>
              {projeto.ambientes.map((a) => <option key={a.name}>{a.name}</option>)}
            </select>
            <span className="urls" title="Definido no qastage.config.json do projeto">
              {env.baseUrl}
              {env.apiUrl && env.apiUrl !== env.baseUrl && <> · API {env.apiUrl}</>}
              <span className={`selo ${env.writable ? "" : "aviso"}`}>{env.writable ? "escrita" : "só leitura"}</span>
              {env.allowLoad && <span className="selo">carga</span>}
            </span>
          </label>
        )}
        {menu}
      </header>
      <div className="corpo">
        <nav className="menu">
          <a href={`#/p/${id}`} className={rota === "/" ? "ativo" : ""}>Visão geral</a>
          {paineis.map((p) => (
            <a key={p.name} href={`#/p/${id}${p.webRemote.route}`} className={p === atual ? "ativo" : ""}>
              {p.webRemote.title}
            </a>
          ))}
          <a href="#/" className="voltar">← Todos os projetos</a>
        </nav>
        <main className="conteudo">
          {erro && <pre className="erro">{erro}</pre>}
          {!erro && !projeto && <p>Carregando projeto…</p>}
          {projeto && rota === "/" && <ProjectHome projeto={projeto} paineis={paineis} />}
          {projeto && env && atual && (
            <Limite key={`${atual.name}:${arquivo ?? ""}`} nome={atual.webRemote.title}>
              <PainelRemoto
                remote={atual.webRemote}
                props={{
                  apiBase: API,
                  env,
                  project: { id: projeto.id, name: projeto.name },
                  ...(arquivo ? { file: arquivo } : {}),
                  ...(projeto.plugins[atual.name] ? { defaults: projeto.plugins[atual.name] } : {}),
                }}
              />
            </Limite>
          )}
          {projeto && rota !== "/" && !atual && <p className="erro">Painel não encontrado: {rota}</p>}
        </main>
      </div>
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
