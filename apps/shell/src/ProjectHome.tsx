import type { FeatureFileInfo } from "@qastage/web-kit";
import { useEffect, useState } from "react";
import { getJson, ROTULO_PLUGIN, type ComPainel, type Projeto } from "./api";

/** Visão geral do projeto: os .feature por tipo, cada um abrindo no painel certo. */
export function ProjectHome({ projeto, paineis }: { projeto: Projeto; paineis: ComPainel[] }) {
  const [arquivos, setArquivos] = useState<FeatureFileInfo[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  useEffect(() => {
    getJson<FeatureFileInfo[]>(`/api/projects/${projeto.id}/features`).then(setArquivos).catch((e: Error) => setErro(e.message));
  }, [projeto.id]);

  const rotaDo = (plugin: string) => paineis.find((p) => p.name === plugin)?.webRemote.route;

  return (
    <div className="home-proj">
      <h1>{projeto.name}</h1>
      <p className="sub">Testes do projeto, por tipo. Abra um arquivo para editar e executar.</p>
      {erro && <p className="erro">{erro}</p>}
      <div className="grupos">
        {Object.entries(ROTULO_PLUGIN).map(([plugin, rotulo]) => {
          const doTipo = arquivos?.filter((a) => a.plugin === plugin) ?? [];
          const rota = rotaDo(plugin);
          return (
            <section key={plugin} className="grupo">
              <div className="grupo-cab">
                <h2>{rotulo}</h2>
                {rota && <a href={`#/p/${projeto.id}${rota}`}>abrir painel</a>}
              </div>
              {arquivos && doTipo.length === 0 && <p className="sub">Nenhum arquivo ainda.</p>}
              <ul>
                {doTipo.map((a) => (
                  <li key={a.path}>
                    <a href={`#/p/${projeto.id}${rota ?? ""}?arquivo=${encodeURIComponent(a.path)}`}>{a.title}</a>
                    <span className="sub mono"> {a.path} · {a.scenarios} cenário{a.scenarios === 1 ? "" : "s"}</span>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
