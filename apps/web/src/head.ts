import { type HeadModel } from "./routes-meta.ts";

const ATTR = "data-head";
const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ESCAPES[c] ?? c);

/** The per-route head as HTML for the prerenderer. Every managed tag carries data-head so the client can replace it. */
export function headToHtml(head: HeadModel): string {
  const tags = head.tags.map((t) => `<${t.tag} ${Object.entries(t.attrs).map(([k, v]) => `${k}="${esc(v)}"`).join(" ")} ${ATTR}>`);
  const ld = head.jsonLd.map((j) => `<script type="application/ld+json" ${ATTR}>${j}</script>`);
  return [`<title>${esc(head.title)}</title>`, ...tags, ...ld].join("\n    ");
}

/** Client navigation: swap the title and every data-head tag in place. */
export function applyHead(doc: Document, head: HeadModel): void {
  doc.title = head.title;
  doc.head.querySelectorAll(`[${ATTR}]`).forEach((el) => el.remove());
  for (const t of head.tags) {
    const el = doc.createElement(t.tag);
    for (const [k, v] of Object.entries(t.attrs)) el.setAttribute(k, v);
    el.setAttribute(ATTR, "");
    doc.head.append(el);
  }
  for (const json of head.jsonLd) {
    const el = doc.createElement("script");
    el.type = "application/ld+json";
    el.setAttribute(ATTR, "");
    el.textContent = json;
    doc.head.append(el);
  }
}
