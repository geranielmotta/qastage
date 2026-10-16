// Jira de mentira para desenvolver e testar a integração sem um Jira real.
// Fala as rotas que o QAStage usa, nas APIs v2 (Server/DC) e v3 (Cloud).
//
//   node examples/jira-fake/server.mjs [porta]      (padrão 4180)
//   GET  /_issues              estado: cards, comentários e anexos
//   POST /_issues/:key/close   fecha o card (o próximo erro igual abre outro)
//   POST /_down  /  POST /_up  simula o Jira fora do ar (503)
import { createServer } from "node:http";

const porta = Number(process.argv[2] ?? 4180);
const issues = [];
let fora = false;
const seq = {};

const json = (res, status, body) => res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
const corpo = async (req) => {
  const partes = [];
  for await (const c of req) partes.push(c);
  return Buffer.concat(partes);
};

createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const p = url.pathname;

  if (p === "/_issues" && req.method === "GET") return json(res, 200, issues);
  if (p === "/_down") return (fora = true), json(res, 200, { fora });
  if (p === "/_up") return (fora = false), json(res, 200, { fora });
  const fechar = p.match(/^\/_issues\/([\w-]+)\/close$/);
  if (fechar) {
    const i = issues.find((x) => x.key === fechar[1]);
    if (i) i.status = "Done";
    return json(res, i ? 200 : 404, i ?? {});
  }

  const api = p.match(/^\/rest\/api\/(2|3)(\/.*)$/);
  if (!api) return json(res, 404, { errorMessages: ["rota desconhecida"] });
  if (fora) return json(res, 503, { errorMessages: ["Jira indisponível (simulado)"] });
  if (!req.headers.authorization) return json(res, 401, { errorMessages: ["sem credenciais"] });
  const [, versao, rota] = api;

  if (rota === "/myself") return json(res, 200, { displayName: "Robô QAStage (fake)" });

  if ((rota === "/search" && versao === "2") || (rota === "/search/jql" && versao === "3")) {
    const jql = url.searchParams.get("jql") ?? "";
    const label = jql.match(/labels = "([^"]+)"/)?.[1];
    const projeto = jql.match(/project = "([^"]+)"/)?.[1];
    const abertos = jql.includes("statusCategory != Done");
    const achados = issues
      .filter((i) => (!label || i.labels.includes(label)) && (!projeto || i.project === projeto) && (!abertos || i.status !== "Done"))
      .reverse();
    return json(res, 200, { issues: achados.slice(0, Number(url.searchParams.get("maxResults") ?? 50)).map((i) => ({ key: i.key })) });
  }

  if (rota === "/issue" && req.method === "POST") {
    const { fields } = JSON.parse((await corpo(req)).toString("utf8"));
    const esperado = versao === "3" ? "object" : "string";
    if (typeof fields.description !== esperado) {
      return json(res, 400, { errors: { description: `API v${versao} espera description como ${esperado}` } });
    }
    seq[fields.project.key] = (seq[fields.project.key] ?? 0) + 1;
    const key = `${fields.project.key}-${seq[fields.project.key]}`;
    issues.push({
      key,
      project: fields.project.key,
      type: fields.issuetype.name,
      summary: fields.summary,
      labels: fields.labels ?? [],
      status: "To Do",
      api: `v${versao}`,
      description: fields.description,
      comments: [],
      attachments: [],
    });
    return json(res, 201, { id: String(issues.length), key });
  }

  const sub = rota.match(/^\/issue\/([\w-]+)\/(comment|attachments)$/);
  if (sub && req.method === "POST") {
    const issue = issues.find((i) => i.key === sub[1]);
    if (!issue) return json(res, 404, { errorMessages: ["card não existe"] });
    const raw = await corpo(req);
    if (sub[2] === "comment") {
      issue.comments.push(JSON.parse(raw.toString("utf8")).body);
      return json(res, 201, { id: String(issue.comments.length) });
    }
    if (req.headers["x-atlassian-token"] !== "no-check") return json(res, 403, { errorMessages: ["XSRF check failed"] });
    const nomes = [...raw.toString("latin1").matchAll(/filename="([^"]+)"/g)].map((m) => m[1]);
    issue.attachments.push(...nomes);
    return json(res, 200, nomes.map((filename) => ({ filename })));
  }

  json(res, 404, { errorMessages: [`não implementado no fake: ${req.method} ${rota}`] });
}).listen(porta, () => console.log(`jira-fake em http://localhost:${porta}`));
