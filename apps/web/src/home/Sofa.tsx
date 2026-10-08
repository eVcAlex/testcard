import { Link } from "@tanstack/react-router";
import { Shot } from "./shots.tsx";

export function Sofa() {
  return (
    <section className="section" aria-labelledby="hm-sofa">
      <div className="wrap">
        <div className="hm-two hm-sofa-head">
          <div className="hm-copy">
            <h2 id="hm-sofa">On the sofa and at the desk.</h2>
            <p>One account keeps your sources, favourites and where you left off across Windows and Fire TV. The Fire TV app is built for a remote and a distance, the Windows app for a mouse and a keyboard.</p>
          </div>
          <div className="hm-copy">
            <h3>Sign in on the TV with a code</h3>
            <ol className="hm-steps">
              <li><b>On the TV:</b> open Link TV and read the code.</li>
              <li><b>On your computer:</b> enter it on the Link TV page.</li>
              <li><b>Done:</b> the TV is signed in to the same account.</li>
            </ol>
            <p><Link to="/link">Open the Link TV page</Link></p>
          </div>
        </div>
        <div className="hm-shots">
          <Shot file="tv-guide.webp" />
          <Shot file="desktop-live.webp" />
        </div>
      </div>
    </section>
  );
}
