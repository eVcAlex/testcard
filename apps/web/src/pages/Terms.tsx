import { Link } from "@tanstack/react-router";
import { CONTACT_EMAIL, ORG_NAME, PRODUCT_NAME } from "../site.ts";
import { BackChip } from "../ui/parts.tsx";

const SECTIONS = [
  ["what", "What this is"],
  ["content", "Your channels and content"],
  ["free", "The beta, and price"],
  ["account", "Your account"],
  ["use", "Fair use"],
  ["liability", "No guarantees"],
  ["changes", "Changes"],
  ["contact", "Contact"],
] as const;

const Mail = () => <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>;

export function Terms() {
  return (
    <article className="page-in wrap prose has-toc">
      <BackChip />
      <h1 className="case-title split" tabIndex={-1}>Terms</h1>
      <p className="case-lede" data-rise>The rules for using {PRODUCT_NAME} and this website, in plain English. Last updated 10 October 2026.</p>
      <nav className="toc" aria-label="On this page">
        <b>On this page</b>
        <ol>{SECTIONS.map(([id, label]) => <li key={id}><a href={`#${id}`}>{label}</a></li>)}</ol>
      </nav>

      <section id="what" aria-labelledby="what-h" className="block">
        <h2 id="what-h">What this is</h2>
        <p>{PRODUCT_NAME} is an IPTV player for Windows and Fire TV, made by {ORG_NAME}. {ORG_NAME} is a name we trade under, not a registered company. By installing the apps, creating an account or using this website you agree to these terms. If you don't agree, please don't use them.</p>
      </section>

      <section id="content" aria-labelledby="content-h" className="block">
        <h2 id="content-h">Your channels and content</h2>
        <p>{PRODUCT_NAME} comes with no channels, films, series or guide data. It plays what you add from your own provider. We don't supply, host, sell or recommend any content or provider, and we don't check what you add.</p>
        <p>You are responsible for only adding sources you are entitled to use, and for obeying the law and your provider's terms where you live.</p>
      </section>

      <section id="free" aria-labelledby="free-h" className="block">
        <h2 id="free-h">The beta, and price</h2>
        <p>The beta is free. It is unfinished software: expect bugs, changes, and things that stop working. We may change it, limit it or stop it at any time. We haven't set what {PRODUCT_NAME} will cost after the beta, and we will say so on this site before anything is charged for. Nothing is charged for now.</p>
      </section>

      <section id="account" aria-labelledby="account-h" className="block">
        <h2 id="account-h">Your account</h2>
        <p>An account is optional and only needed for sync and linking a TV. Keep your password safe: because your provider logins are encrypted with a key from it, we can't recover it (see the <Link to="/privacy">privacy page</Link>). You can ask us to delete your account at any time.</p>
      </section>

      <section id="use" aria-labelledby="use-h" className="block">
        <h2 id="use-h">Fair use</h2>
        <p>Please don't attack, overload or probe the sync service or this website, try to get into other people's accounts, or use {PRODUCT_NAME} to break the law. We may block access or remove an account that does.</p>
      </section>

      <section id="liability" aria-labelledby="liability-h" className="block">
        <h2 id="liability-h">No guarantees</h2>
        <p>{PRODUCT_NAME} is provided as it is, with no promise that it will work, be available, or suit what you want. We aren't responsible for your provider, its content, or what you watch with the app. To the extent the law allows, we are not liable for losses arising from using it. Nothing here limits anything the law doesn't allow us to limit.</p>
      </section>

      <section id="changes" aria-labelledby="changes-h" className="block">
        <h2 id="changes-h">Changes</h2>
        <p>We may update these terms. The date at the top shows when they last changed, and continuing to use {PRODUCT_NAME} after a change means you accept it.</p>
      </section>

      <section id="contact" aria-labelledby="contact-h" className="block">
        <h2 id="contact-h">Contact</h2>
        <p>Questions about these terms: <Mail />.</p>
      </section>
    </article>
  );
}
