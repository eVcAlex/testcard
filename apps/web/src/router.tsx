import { type RouteComponent, type RouterHistory, Outlet, createRootRoute, createRoute, createRouter, lazyRouteComponent } from "@tanstack/react-router";
// Styles used by the lazy /download chunk are imported here too, so a prerendered /download is styled before that chunk loads.
import "./components/waitlist.css";
import "./pages/content.css";
import { Footer } from "./components/Footer.tsx";
import { Head } from "./components/Head.tsx";
import { Header } from "./components/Header.tsx";
import { Faq } from "./pages/Faq.tsx";
import { Home } from "./pages/Home.tsx";
import { NotFound } from "./pages/NotFound.tsx";
import { Privacy } from "./pages/Privacy.tsx";
import { Setup } from "./pages/Setup.tsx";

const root = createRootRoute({
  component: () => (
    <>
      <a className="skip" href="#main">Skip to content</a>
      <Header />
      <main id="main" tabIndex={-1}><Outlet /></main>
      <Footer />
      <Head />
    </>
  ),
});

const at = <P extends string>(path: P, component: RouteComponent) => createRoute({ getParentRoute: () => root, path, component });

// React Query (and the Link TV crypto) load only with these two routes.
const download = at("/download", lazyRouteComponent(() => import("./pages/DownloadRoute.tsx"), "DownloadRoute"));
const link = at("/link", lazyRouteComponent(() => import("./pages/LinkRoute.tsx"), "LinkRoute"));

const routeTree = root.addChildren([at("/", Home), download, at("/setup", Setup), at("/faq", Faq), at("/privacy", Privacy), link]);

export const createAppRouter = (opts: { history?: RouterHistory; isServer?: boolean } = {}) =>
  createRouter({ routeTree, defaultNotFoundComponent: NotFound, defaultPreload: "intent", ...opts });

export type AppRouter = ReturnType<typeof createAppRouter>;

declare module "@tanstack/react-router" {
  interface Register { router: AppRouter }
}
