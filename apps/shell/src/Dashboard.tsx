import { useEffect, useState, type FormEvent } from "react";
import { getJson, ROTULO_PLUGIN, type ProjetoResumo } from "./api";

const quando = (iso: string) => new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const STATUS = { passed: "passou", failed: "falhou", error: "erro", skipped: "pulado" } as const;

/** Tela inicial: todos os projetos do QA, com o estado de cada um, e a criação de um novo. */
export function Dashboard({ admin }: { admin: boolean }) {
  const [projetos, setProjetos] = useState<ProjetoResumo[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [criando, setCriando] = useState(false);

  const carregar = () =>
    getJson<ProjetoResumo[]>("/api/projects")
      .then(setProjetos)
      .catch((e: Error) => setErro(e.message));
  useEffect(() => void carregar(), []);

  return (
    <div className="dash">
      <div className="dash-topo">
        <div>
          <h1>Projetos</h1>
          <p className="sub">Escolha um projeto para continuar os testes.</p>
        </div>
        {admin && <button className="primario" onClick={() => setCriando((v) => !v)}>{criando ? "Cancelar" : "+ Novo projeto"}</button>}
      </div>
      {criando && <NovoProjeto />}
      {erro && <p className="erro">{erro}</p>}
      {projetos && projetos.length === 0 && !criando && (
        <p className="vazio">
          {admin ? (
            <>Nenhum projeto ainda. Crie o primeiro com <strong>+ Novo projeto</strong>.</>
          ) : (
            <>Nenhum projeto atribuído a você ainda. Peça ao administrador para liberar os projetos que vai testar.</>
          )}
        </p>
      )}
      <div className="cards">
        {projetos?.map((p) => (p.error ? <CardComErro key={p.id} p={p} /> : <Card key={p.id} p={p} />))}
      </div>
    </div>
  );
}

function Card({ p }: { p: ProjetoResumo }) {
  const ultima = p.ultimas?.[0];
  return (
    <a className="card-proj" href={`#/p/${p.id}`}>
      <div className="card-cab">
        <h2>{p.name}</h2>
        {ultima && <span className={`selo-status ${ultima.status}`}>{STATUS[ultima.status]}</span>}
      </div>
      <p className="sub mono">{p.dir}</p>
      <div className="chips">
        {p.ambientes?.map((a) => (
          <span key={a.name} className="chip" title={a.apiUrl ?? a.baseUrl}>
            {a.name}
            {!a.writable && <span className="mini"> · leitura</span>}
            {a.allowLoad && <span className="mini"> · carga</span>}
          </span>
        ))}
      </div>
      <div className="contagem">
        {Object.entries(ROTULO_PLUGIN).map(([plugin, rotulo]) => (
          <div key={plugin}>
            <strong>{p.cenarios?.[plugin] ?? 0}</strong>
            <span>{rotulo}</span>
          </div>
        ))}
      </div>
      <div className="historico" aria-label="Últimas execuções">
        {p.ultimas?.length ? (
          p.ultimas.map((u) => (
            <span key={u.id} className={`ponto ${u.status}`} title={`${ROTULO_PLUGIN[u.plugin] ?? u.plugin} · ${u.env} · ${quando(u.startedAt)} · ${STATUS[u.status]}`} />
          ))
        ) : (
          <span className="sub">Nenhuma execução ainda</span>
        )}
        {ultima && <span className="sub"> última: {quando(ultima.startedAt)}</span>}
      </div>
    </a>
  );
}

function CardComErro({ p }: { p: ProjetoResumo }) {
  return (
    <div className="card-proj com-erro">
      <h2>{p.name}</h2>
      <p className="sub mono">{p.dir}/qastage.config.json</p>
      <pre className="erro">{p.error}</pre>
    </div>
  );
}

function NovoProjeto() {
  const [f, setF] = useState({ nome: "", front: "", api: "", spec: "" });
  const [erro, setErro] = useState<string | null>(null);
  const campo = (k: keyof typeof f) => ({ value: f[k], onChange: (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value }) });

  const criar = async (e: FormEvent) => {
    e.preventDefault();
    setErro(null);
    try {
      const r = await getJson<{ id: string }>("/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(f),
      });
      location.hash = `#/p/${r.id}`;
    } catch (err) {
      setErro((err as Error).message);
    }
  };

  return (
    <form className="novo" onSubmit={criar}>
      <h2>Novo projeto</h2>
      <p className="sub">
        Cria <code>projetos/&lt;nome&gt;/qastage.config.json</code> com o ambiente <strong>qa</strong>. Escrita e carga começam
        desligadas: libere no arquivo quando for seguro.
      </p>
      <div className="campos">
        <label>Nome *<input required {...campo("nome")} placeholder="Portal Clientes" /></label>
        <label>URL do front (QA) *<input required type="url" {...campo("front")} placeholder="https://qa.portal.com" /></label>
        <label>URL da API (QA)<input type="url" {...campo("api")} placeholder="https://api-qa.portal.com" /></label>
        <label>Swagger / OpenAPI / Postman<input {...campo("spec")} placeholder="https://api-qa.portal.com/openapi.json" /></label>
      </div>
      {erro && <pre className="erro">{erro}</pre>}
      <button className="primario" type="submit">Criar projeto</button>
    </form>
  );
}
