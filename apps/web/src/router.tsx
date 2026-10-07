import { Link, Outlet, createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import { Home } from "./pages/Home.tsx";

const root = createRootRoute({
  component: () => (
    <>
      <header className="bar">
        <Link to="/" className="brand">test<b>card</b></Link>
        <nav>
          <Link to="/download">Download</Link>
          <Link to="/link">Link TV</Link>
        </nav>
      </header>
      <main><Outlet /></main>
    </>
  ),
});

const home = createRoute({ getParentRoute: () => root, path: "/", component: Home });

// Placeholders so the nav links typecheck; Tasks 4 and 5 replace these with Download and LinkPage.
const download = createRoute({ getParentRoute: () => root, path: "/download", component: () => null });
const link = createRoute({ getParentRoute: () => root, path: "/link", component: () => null });

export const router = createRouter({ routeTree: root.addChildren([home, download, link]) });

declare module "@tanstack/react-router" {
  interface Register { router: typeof router }
}
