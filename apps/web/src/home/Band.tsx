import { Link } from "@tanstack/react-router";
import { WaitlistLink } from "./WaitlistLink.tsx";

export function Band() {
  return (
    <section className="section hm-band" aria-labelledby="hm-join">
      <div className="wrap">
        <h2 id="hm-join">Be there for the beta.</h2>
        <p className="lead">Testcard is not released yet. Join the waitlist and you will be invited to try it on Windows and Fire TV. It is free.</p>
        <div className="actions">
          <WaitlistLink className="button hm-big">Get on the waitlist</WaitlistLink>
          <Link to="/setup" className="button ghost hm-big">Setup guide</Link>
        </div>
      </div>
    </section>
  );
}
