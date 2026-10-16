import { useState, type FormEvent } from "react";
import { enviar, type Usuario } from "./api";

/** Tela de entrada. `setup` = nenhum usuário existe ainda: cria o administrador. */
export function Entrar({ setup, onEntrou }: { setup: boolean; onEntrou: (u: Usuario) => void }) {
  const [f, setF] = useState({ nome: "", email: "", senha: "", confirma: "" });
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const campo = (k: keyof typeof f) => ({ value: f[k], onChange: (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value }) });

  const submeter = async (e: FormEvent) => {
    e.preventDefault();
    setErro(null);
    if (setup && f.senha !== f.confirma) return setErro("As senhas não conferem.");
    setEnviando(true);
    try {
      const r = setup
        ? await enviar<{ usuario: Usuario }>("/api/auth/setup", "POST", { nome: f.nome, email: f.email, senha: f.senha })
        : await enviar<{ usuario: Usuario }>("/api/auth/login", "POST", { email: f.email, senha: f.senha });
      onEntrou(r.usuario);
    } catch (err) {
      setErro((err as Error).message);
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="entrar">
      <form onSubmit={submeter} className="entrar-caixa">
        <h1>QAStage</h1>
        {setup ? (
          <p className="sub">Primeiro acesso: crie a conta de <strong>administrador</strong>. Ele cadastra os QAs e atribui os projetos.</p>
        ) : (
          <p className="sub">Entre para ver os projetos atribuídos a você.</p>
        )}
        {setup && <label>Nome<input required autoComplete="name" {...campo("nome")} /></label>}
        <label>E-mail<input required type="email" autoComplete="username" {...campo("email")} /></label>
        <label>Senha<input required type="password" autoComplete={setup ? "new-password" : "current-password"} minLength={setup ? 8 : undefined} {...campo("senha")} /></label>
        {setup && <label>Confirme a senha<input required type="password" autoComplete="new-password" {...campo("confirma")} /></label>}
        {erro && <p className="erro">{erro}</p>}
        <button className="primario" type="submit" disabled={enviando}>{setup ? "Criar administrador" : "Entrar"}</button>
      </form>
    </div>
  );
}

/** Troca da própria senha (também usada no primeiro acesso com senha temporária). */
export function TrocarSenha({ onFechar }: { onFechar: () => void }) {
  const [f, setF] = useState({ atual: "", nova: "", confirma: "" });
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);
  const campo = (k: keyof typeof f) => ({ value: f[k], onChange: (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value }) });

  const salvar = async (e: FormEvent) => {
    e.preventDefault();
    if (f.nova !== f.confirma) return setMsg({ ok: false, texto: "As senhas novas não conferem." });
    try {
      await enviar("/api/auth/senha", "POST", { atual: f.atual, nova: f.nova });
      setMsg({ ok: true, texto: "Senha alterada. Outras sessões abertas foram encerradas." });
      setF({ atual: "", nova: "", confirma: "" });
    } catch (err) {
      setMsg({ ok: false, texto: (err as Error).message });
    }
  };

  return (
    <div className="modal-fundo" role="dialog" aria-label="Trocar senha" onClick={onFechar}>
      <form className="modal" onSubmit={salvar} onClick={(e) => e.stopPropagation()}>
        <h2>Trocar senha</h2>
        <label>Senha atual<input required type="password" autoComplete="current-password" {...campo("atual")} /></label>
        <label>Nova senha<input required type="password" minLength={8} autoComplete="new-password" {...campo("nova")} /></label>
        <label>Confirme a nova senha<input required type="password" autoComplete="new-password" {...campo("confirma")} /></label>
        {msg && <p className={msg.ok ? "ok" : "erro"}>{msg.texto}</p>}
        <div className="acoes">
          <button type="button" onClick={onFechar}>Fechar</button>
          <button className="primario" type="submit">Salvar</button>
        </div>
      </form>
    </div>
  );
}
