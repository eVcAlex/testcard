import { Link } from "@tanstack/react-router";
import { ColourBars } from "../components/ColourBars.tsx";

export function NotFound() {
  return (
    <section className="wrap page nosignal">
      <ColourBars tall />
      <h1>No signal</h1>
      <p className="lead">That page isn't here. It may have moved, or the address is wrong.</p>
      <Link to="/">Back to the home page</Link>
    </section>
  );
}
