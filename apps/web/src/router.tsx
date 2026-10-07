import { Link, Outlet, createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import { Footer } from "./Footer.tsx";
import { Download } from "./pages/Download.tsx";
import { Home } from "./pages/Home.tsx";
import { LinkPage } from "./pages/LinkPage.tsx";
import { NotFound } from "./pages/NotFound.tsx";
import { Privacy } from "./pages/Privacy.tsx";

const root = createRootRoute({
  component: () => (
    <>
      <header className="bar">
        <Link to="/" className="brand"><img src="/favicon.svg" width="28" height="28" alt="" />test<b>card</b></Link>
        <nav>
          <Link to="/download">Download</Link>
          <Link to="/link">Link TV</Link>
        </nav>
      </header>
      <main><Outlet /></main>
      <Footer />
    </>
  ),
});

const home = createRoute({ getParentRoute: () => root, path: "/", component: Home });

const download = createRoute({ getParentRoute: () => root, path: "/download", component: Download });
const link = createRoute({ getParentRoute: () => root, path: "/link", component: LinkPage });
const privacy = createRoute({ getParentRoute: () => root, path: "/privacy", component: Privacy });

export const router = createRouter({ routeTree: root.addChildren([home, download, link, privacy]), defaultNotFoundComponent: NotFound });

declare module "@tanstack/react-router" {
  interface Register { router: typeof router }
}
