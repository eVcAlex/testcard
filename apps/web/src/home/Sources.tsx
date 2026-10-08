import { Link } from "@tanstack/react-router";

export function Sources() {
  return (
    <section className="section" aria-labelledby="hm-sources">
      <div className="wrap hm-two">
        <div className="hm-copy">
          <h2 id="hm-sources">Bring your own sources.</h2>
          <p><b>Testcard ships no channels.</b> It is a player: we don&rsquo;t sell, host or recommend channels or providers, and there is nothing to subscribe to here. Without a source it is an empty guide.</p>
          <p><Link to="/faq">Where do channels come from? Read the FAQ</Link></p>
        </div>
        <div className="hm-is">
          <div>
            <h3>You add</h3>
            <ul>
              <li>an <b>Xtream</b> login: server, username, password</li>
              <li>or an <b>M3U</b> playlist URL</li>
              <li>and an <b>XMLTV</b> guide if your source has one</li>
            </ul>
          </div>
          <div>
            <h3>Testcard does</h3>
            <ul>
              <li>tidy the names and group the channels</li>
              <li>show them on a programme guide</li>
              <li>keep them in step across your screens</li>
            </ul>
            <p><Link to="/setup">Read the setup guide</Link></p>
          </div>
        </div>
      </div>
    </section>
  );
}
