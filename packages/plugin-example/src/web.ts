/**
 * A metade "front" deste plugin (placeholder do F0).
 *
 * No F1+ isto vira um remote React federado no shell via Module Federation.
 * Por ora, só descreve o painel que o plugin exporia ao QA, para o contrato
 * mostrar as duas pontas.
 */
export interface WebPanel {
  /** Título exibido na navegação do shell. */
  title: string;
  /** Rota do painel dentro do shell. */
  route: string;
}

export const webPanel: WebPanel = {
  title: "Exemplo",
  route: "/example",
};
