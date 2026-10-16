import { useEffect, useState, type FormEvent } from "react";
import { enviar, getJson, type ProjetoResumo, type Usuario } from "./api";

/** Administração: usuários, papéis e quais projetos cada QA testa. */
export function Admin({ eu }: { eu: Usuario }) {
  const [usuarios, setUsuarios] = useState<Usuario[] | null>(null);
  const [projetos, setProjetos] = useState<ProjetoResumo[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  /** Senha temporária recém-gerada: aparece uma vez para o admin repassar. */
  const [senha, setSenha] = useState<{ email: string; senha: string } | null>(null);

  const carregar = () => {
    getJson<Usuario[]>("/api/admin/usuarios").then(setUsuarios).catch((e: Error) => setErro(e.message));
    getJson<ProjetoResumo[]>("/api/projects").then(setProjetos).catch((e: Error) => setErro(e.message));
  };
  useEffect(carregar, []);

  const alterar = async (u: Usuario, mudanca: Partial<Usuario> & { redefinirSenha?: boolean }) => {
    setErro(null);
    // Otimista: a tela responde na hora; se o runner recusar, volta ao estado anterior.
    const { redefinirSenha: _, ...visivel } = mudanca;
    setUsuarios((us) => us?.map((x) => (x.id === u.id ? { ...x, ...visivel } : x)) ?? null);
    try {
      const r = await enviar<{ usuario: Usuario; senhaTemporaria?: string }>(`/api/admin/usuarios/${u.id}`, "PATCH", mudanca);
      setUsuarios((us) => us?.map((x) => (x.id === u.id ? r.usuario : x)) ?? null);
      if (r.senhaTemporaria) setSenha({ email: u.email, senha: r.senhaTemporaria });
    } catch (e) {
      setUsuarios((us) => us?.map((x) => (x.id === u.id ? u : x)) ?? null);
      setErro((e as Error).message);
    }
  };

  const alternarProjeto = (u: Usuario, projeto: string) =>
    alterar(u, { projetos: u.projetos.includes(projeto) ? u.projetos.filter((p) => p !== projeto) : [...u.projetos, projeto] });

  return (
    <div className="admin">
      <h1>Administração</h1>
      <p className="sub">Cadastre os QAs e marque os projetos que cada um testa. QA só vê os projetos marcados; admin vê todos.</p>
      <NovoUsuario projetos={projetos} onCriado={(u, s) => (setUsuarios((us) => [...(us ?? []), u]), setSenha({ email: u.email, senha: s }))} />
      {senha && (
        <div className="aviso-senha" role="status">
          Senha temporária de <strong>{senha.email}</strong>: <code>{senha.senha}</code>
          <span className="sub"> — repasse por um canal seguro; ela não será mostrada de novo. A pessoa troca no primeiro acesso.</span>
          <button onClick={() => setSenha(null)}>Ok</button>
        </div>
      )}
      {erro && <pre className="erro">{erro}</pre>}
      <div className="tabela-admin">
        <table>
          <thead>
            <tr>
              <th>Pessoa</th>
              <th>Papel</th>
              {projetos.map((p) => <th key={p.id} className="col-proj" title={p.dir}>{p.name}</th>)}
              <th>Ações</th>
            </tr>
          </thead>
          <tbody>
            {usuarios?.map((u) => (
              <tr key={u.id} className={u.ativo ? "" : "inativo"}>
                <td>
                  <strong>{u.nome}</strong>
                  {u.id === eu.id && <span className="sub"> (você)</span>}
                  <div className="sub">{u.email}{!u.ativo && " · inativo"}</div>
                </td>
                <td>
                  <select value={u.papel} onChange={(e) => alterar(u, { papel: e.target.value as Usuario["papel"] })} aria-label={`Papel de ${u.nome}`}>
                    <option value="qa">QA</option>
                    <option value="admin">Admin</option>
                  </select>
                </td>
                {projetos.map((p) => (
                  <td key={p.id} className="col-proj">
                    {u.papel === "admin" ? (
                      <span className="sub" title="Admin vê todos os projetos">todos</span>
                    ) : (
                      <input
                        type="checkbox"
                        checked={u.projetos.includes(p.id)}
                        onChange={() => alternarProjeto(u, p.id)}
                        aria-label={`${u.nome} testa ${p.name}`}
                      />
                    )}
                  </td>
                ))}
                <td>
                  <div className="acoes-linha">
                    <button onClick={() => alterar(u, { redefinirSenha: true })}>Redefinir senha</button>
                    {u.id !== eu.id && (
                      <button onClick={() => alterar(u, { ativo: !u.ativo })}>{u.ativo ? "Desativar" : "Reativar"}</button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function NovoUsuario({ projetos, onCriado }: { projetos: ProjetoResumo[]; onCriado: (u: Usuario, senha: string) => void }) {
  const [f, setF] = useState({ nome: "", email: "", papel: "qa" as Usuario["papel"], projetos: [] as string[] });
  const [erro, setErro] = useState<string | null>(null);

  const criar = async (e: FormEvent) => {
    e.preventDefault();
    setErro(null);
    try {
      const r = await enviar<{ usuario: Usuario; senhaTemporaria: string }>("/api/admin/usuarios", "POST", f);
      onCriado(r.usuario, r.senhaTemporaria);
      setF({ nome: "", email: "", papel: "qa", projetos: [] });
    } catch (err) {
      setErro((err as Error).message);
    }
  };

  return (
    <form className="novo-usuario" onSubmit={criar}>
      <h2>Novo usuário</h2>
      <div className="campos">
        <label>Nome<input required value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} /></label>
        <label>E-mail<input required type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></label>
        <label>
          Papel
          <select value={f.papel} onChange={(e) => setF({ ...f, papel: e.target.value as Usuario["papel"] })}>
            <option value="qa">QA</option>
            <option value="admin">Admin</option>
          </select>
        </label>
      </div>
      {f.papel === "qa" && projetos.length > 0 && (
        <fieldset className="projetos-novo">
          <legend>Projetos que vai testar</legend>
          {projetos.map((p) => (
            <label key={p.id} className="check">
              <input
                type="checkbox"
                checked={f.projetos.includes(p.id)}
                onChange={() => setF({ ...f, projetos: f.projetos.includes(p.id) ? f.projetos.filter((x) => x !== p.id) : [...f.projetos, p.id] })}
              />
              {p.name}
            </label>
          ))}
        </fieldset>
      )}
      {erro && <pre className="erro">{erro}</pre>}
      <button className="primario" type="submit">Criar e gerar senha temporária</button>
    </form>
  );
}
