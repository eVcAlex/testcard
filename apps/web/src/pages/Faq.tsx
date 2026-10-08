import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { FAQ, GUIDE_CAUSES, GUIDE_QUESTION, LINK } from "../faq-data.ts";
import { CONTACT_EMAIL, PRODUCT_NAME } from "../site.ts";

/** Answer paragraph with `[text](/path#hash)` links turned into router links. */
function Para({ text }: { text: string }): ReactNode {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(LINK)) {
    out.push(text.slice(last, m.index));
    const [path = "/", hash] = (m[2] ?? "/").split("#");
    out.push(<Link key={m.index} to={path as "/"} hash={hash}>{m[1]}</Link>);
    last = m.index + m[0].length;
  }
  out.push(text.slice(last));
  return <p>{out}</p>;
}

export function Faq() {
  return (
    <article className="wrap page prose faq">
      <h1>{PRODUCT_NAME} IPTV player FAQ</h1>
      <p className="lead">Plain answers about sources, the guide, installing and what {PRODUCT_NAME} does and doesn't do.</p>
      <h2 id="questions">Questions</h2>
      {FAQ.map((item) => (
        <details key={item.id} id={item.id}>
          <summary><h3>{item.question}</h3></summary>
          <div>{item.answer.map((p) => <Para key={p} text={p} />)}</div>
        </details>
      ))}
      <section id="guide" aria-labelledby="guide-h" className="faq-group">
        <h2 id="guide-h">{GUIDE_QUESTION}</h2>
        <p>Check these in this order. Most empty guides are the first or the last.</p>
        <ol className="causes">
          {GUIDE_CAUSES.map((c) => (
            <li key={c.id} id={c.id}><b>{c.title}</b> {c.text}</li>
          ))}
        </ol>
        <p><Link to="/setup" hash="guide">How the guide is set up</Link>.</p>
      </section>
      <p className="note">Not answered here? Email <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.</p>
    </article>
  );
}
