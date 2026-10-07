import { Link } from "@tanstack/react-router";
import { SHOTS } from "../site.ts";

const pairs = [
  ["Every provider names channels differently", "Names are tidied, so lists read the same everywhere."],
  ["Different app on every screen, progress lost", "One account keeps sources, favourites and where you left off across Windows and Fire TV."],
  ["A channel dies and you hunt for another", "Testcard tries the channel's other feeds and qualities for you."],
  ["No guide, or a guide you can't read", "A full TV guide grid with now and next."],
] as const;

const features = [
  ["Your sources, one place", "Add Xtream Codes or M3U playlists. Live channels, films and series sit together and stay fast, even with tens of thousands of channels."],
  ["A real TV guide", "A full guide grid with now and next. Catch up on shows from providers that keep an archive."],
  ["Tidy names", "Channel and category names are cleaned up whatever the provider's style, so \"UK| ʙʙᴄ ᴏɴᴇ ᴴᴰ\" reads as \"BBC One HD\"."],
  ["Picks up where you left off", "One account keeps your sources, favourites and progress in step across Windows and Fire TV."],
  ["Streams that keep going", "If a live channel won't start, Testcard tries its other feeds and qualities for you."],
  ["Made for the sofa", "A layout built for the remote, with Skip intro, a Next episode button and captions you can restyle."],
] as const;

export function Home() {
  return (
    <>
      <section className="hero">
        <h1>Live TV, films and series. Everywhere you watch.</h1>
        <p className="lead">Testcard is a fast, tidy IPTV player for Windows and Fire TV. Bring your own sources and pick up where you left off on any screen.</p>
        <div className="actions">
          <Link to="/download" className="button">Download</Link>
          <Link to="/link" className="button ghost">Link your TV</Link>
        </div>
        <p className="note">Free during early access. Testcard brings no channels: you add your own.</p>
      </section>
      <section className="problem">
        <h2>IPTV, without the mess</h2>
        <ul className="pairs">
          {pairs.map(([problem, answer]) => (
            <li key={problem}><b>{problem}</b><span>{answer}</span></li>
          ))}
        </ul>
      </section>
      <section className="features">
        {features.map(([title, text]) => (
          <div className="card" key={title}>
            <h2>{title}</h2>
            <p>{text}</p>
          </div>
        ))}
      </section>
      {SHOTS.length > 0 && (
        <section className="shots">
          <h2>See it</h2>
          {SHOTS.map((s) => (
            <figure key={s.src}>
              <img src={s.src} alt={s.alt} width={s.width} height={s.height} loading="lazy" decoding="async" />
              <figcaption>{s.caption}</figcaption>
            </figure>
          ))}
        </section>
      )}
      <section className="cta">
        <h2>Get Testcard</h2>
        <div className="actions">
          <Link to="/download" className="button">Download</Link>
          <Link to="/link" className="button ghost">Link your TV</Link>
        </div>
      </section>
    </>
  );
}
