import { useEffect, useState } from "react";
import { listFeatureFiles, readFeatureFile, saveFeatureFile, type FeatureFileInfo } from "./project";

interface Props {
  apiBase: string;
  project: { id: string; name: string };
  plugin: string;
  /** Pasta da convenção: features/ui, features/api, features/carga. */
  folder: string;
  text: string;
  onOpen: (text: string) => void;
  /** Arquivo a abrir primeiro (ex.: vindo da visão geral); padrão: o primeiro da lista. */
  initial?: string;
}

/**
 * Barra de arquivos do projeto: abrir um .feature no editor, salvar de volta,
 * criar um novo. O editor continua sendo do painel.
 */
export function FeatureFiles({ apiBase, project, plugin, folder, text, onOpen, initial }: Props) {
  const [files, setFiles] = useState<FeatureFileInfo[]>([]);
  const [atual, setAtual] = useState<string>("");
  const [salvo, setSalvo] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const recarregar = () => listFeatureFiles(apiBase, project.id, plugin).then(setFiles).catch((e: Error) => setMsg(e.message));

  useEffect(() => {
    setAtual("");
    setSalvo(null);
    listFeatureFiles(apiBase, project.id, plugin)
      .then(async (fs) => {
        setFiles(fs);
        const alvo = fs.find((f) => f.path === initial)?.path ?? fs[0]?.path;
        if (alvo) await abrir(alvo);
      })
      .catch((e: Error) => setMsg(e.message));
  }, [apiBase, project.id, plugin, initial]); // eslint-disable-line react-hooks/exhaustive-deps

  async function abrir(path: string) {
    setMsg(null);
    if (!path) {
      setAtual("");
      setSalvo(null);
      return;
    }
    const t = await readFeatureFile(apiBase, project.id, path);
    setAtual(path);
    setSalvo(t);
    onOpen(t);
  }

  async function salvar(path = atual) {
    try {
      await saveFeatureFile(apiBase, project.id, path, text);
      setAtual(path);
      setSalvo(text);
      setMsg(`Salvo em ${path}`);
      await recarregar();
    } catch (e) {
      setMsg((e as Error).message);
    }
  }

  async function novo() {
    const nome = prompt(`Nome do novo arquivo em ${folder}/ (sem .feature):`);
    if (!nome?.trim()) return;
    const slug = nome.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9/]+/g, "-");
    await salvar(`${folder}/${slug}.feature`);
  }

  const alterado = salvo !== null && salvo !== text;
  return (
    <div className="qs-files">
      <style>{css}</style>
      <label>
        Arquivo do projeto <strong>{project.name}</strong>
        <select value={atual} onChange={(e) => void abrir(e.target.value)}>
          <option value="">— rascunho (não salvo) —</option>
          {files.map((f) => (
            <option key={f.path} value={f.path}>
              {f.path.replace(`${folder}/`, "")} · {f.title} ({f.scenarios} cenário{f.scenarios === 1 ? "" : "s"})
            </option>
          ))}
        </select>
      </label>
      {atual ? (
        <button onClick={() => void salvar()} disabled={!alterado} title={alterado ? "Grava no projeto" : "Sem alterações"}>
          {alterado ? "Salvar ●" : "Salvo"}
        </button>
      ) : null}
      <button onClick={() => void novo()}>{atual ? "Salvar como…" : "Salvar no projeto…"}</button>
      {msg && <span className="qs-msg">{msg}</span>}
    </div>
  );
}

const css = `
.qs-files { display: flex; gap: 8px; align-items: end; flex-wrap: wrap; margin-bottom: 10px; }
.qs-files label { display: flex; flex-direction: column; gap: 4px; font-size: 13px; color: var(--muted, #6b6b75); }
.qs-files select { min-width: 280px; max-width: 100%; }
.qs-files .qs-msg { font-size: 13px; color: var(--muted, #6b6b75); }
`;
