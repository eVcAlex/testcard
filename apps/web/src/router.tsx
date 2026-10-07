import { Link, Outlet, createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import { Footer } from "./Footer.tsx";
import { Download } from "./pages/Download.tsx";
import { Home } from "./pages/Home.tsx";
import { LinkPage } from "./pages/LinkPage.tsx";

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
      <Footer />
    </>
  ),
});

const home = createRoute({ getParentRoute: () => root, path: "/", component: Home });

const download = createRoute({ getParentRoute: () => root, path: "/download", component: Download });
const link = createRoute({ getParentRoute: () => root, path: "/link", component: LinkPage });

export const router = createRouter({ routeTree: root.addChildren([home, download, link]) });

declare module "@tanstack/react-router" {
  interface Register { router: typeof router }
}
