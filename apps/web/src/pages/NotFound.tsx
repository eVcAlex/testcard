import { Link } from "@tanstack/react-router";

export function NotFound() {
  return (
    <section>
      <h1>No signal</h1>
      <p>That page isn't here. It may have moved, or the address is wrong.</p>
      <Link to="/">Back to the home page</Link>
    </section>
  );
}
