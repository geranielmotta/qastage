/**
 * Modelo mínimo de documento, renderizado nos dois formatos do Jira:
 * ADF (Cloud, API v3) e wiki markup (Server/Data Center, API v2).
 */
export type Block =
  | { t: "h"; text: string }
  | { t: "p"; parts: Inline[] }
  | { t: "ol"; items: string[] }
  | { t: "code"; text: string }
  | { t: "table"; rows: Array<[string, string]> };

export type Inline = string | { b: string } | { code: string } | { link: string; text?: string };

// ── ADF ──────────────────────────────────────────────────────────────────────

const adfText = (text: string, marks?: unknown[]) => (marks ? { type: "text", text, marks } : { type: "text", text });

function adfInline(i: Inline): unknown {
  if (typeof i === "string") return adfText(i);
  if ("b" in i) return adfText(i.b, [{ type: "strong" }]);
  if ("code" in i) return adfText(i.code, [{ type: "code" }]);
  return adfText(i.text ?? i.link, [{ type: "link", attrs: { href: i.link } }]);
}

const cell = (type: "tableHeader" | "tableCell", text: string) => ({
  type,
  content: [{ type: "paragraph", content: text ? [adfText(text)] : [] }],
});

export function toAdf(blocks: Block[]): unknown {
  return {
    type: "doc",
    version: 1,
    content: blocks.map((b) => {
      switch (b.t) {
        case "h":
          return { type: "heading", attrs: { level: 3 }, content: [adfText(b.text)] };
        case "p":
          return { type: "paragraph", content: b.parts.filter((p) => p !== "").map(adfInline) };
        case "ol":
          return {
            type: "orderedList",
            content: b.items.map((it) => ({ type: "listItem", content: [{ type: "paragraph", content: [adfText(it)] }] })),
          };
        case "code":
          return { type: "codeBlock", content: b.text ? [adfText(b.text)] : [] };
        case "table":
          return { type: "table", content: b.rows.map(([k, v]) => ({ type: "tableRow", content: [cell("tableHeader", k), cell("tableCell", v)] })) };
      }
    }),
  };
}

// ── Wiki markup ──────────────────────────────────────────────────────────────

/** Escapa os caracteres que o wiki markup interpreta em texto comum. */
const wikiEsc = (s: string) => s.replace(/([{}[\]|*_\-+^~?#])/g, "\\$1");

function wikiInline(i: Inline): string {
  if (typeof i === "string") return wikiEsc(i);
  if ("b" in i) return `*${wikiEsc(i.b)}*`;
  if ("code" in i) return `{{${i.code.replace(/[{}]/g, "\\$&")}}}`;
  return i.text ? `[${wikiEsc(i.text)}|${i.link}]` : `[${i.link}]`;
}

export function toWiki(blocks: Block[]): string {
  return blocks
    .map((b) => {
      switch (b.t) {
        case "h":
          return `h3. ${b.text}`;
        case "p":
          return b.parts.map(wikiInline).join("");
        case "ol":
          return b.items.map((it) => `# ${wikiEsc(it)}`).join("\n");
        case "code":
          return `{noformat}\n${b.text}\n{noformat}`;
        case "table":
          return b.rows.map(([k, v]) => `||${wikiEsc(k)}|${wikiEsc(v) || " "}|`).join("\n");
      }
    })
    .join("\n\n");
}
