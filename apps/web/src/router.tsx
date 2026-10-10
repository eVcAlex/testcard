import { type RouteComponent, type RouterHistory, Outlet, createRootRoute, createRoute, createRouter, lazyRouteComponent } from "@tanstack/react-router";
// Styles used by the lazy /download chunk are imported here too, so a prerendered /download is styled before that chunk loads.
import "./components/waitlist.css";
import "./pages/content.css";
import { Footer } from "./components/Footer.tsx";
import { Head } from "./components/Head.tsx";
import { Header, TopBar } from "./components/Header.tsx";
import { Effects } from "./ui/Effects.tsx";
import { Preloader } from "./ui/Preloader.tsx";
import { Home } from "./pages/Home.tsx";
import { NotFound } from "./pages/NotFound.tsx";

const root = createRootRoute({
  component: () => (
    <>
      <a className="skip" href="#main">Skip to content</a>
      <main id="main" tabIndex={-1}>
        <TopBar />
        <Outlet />
      </main>
      <Footer />
      <Header />
      <Preloader />
      <Effects />
      <Head />
    </>
  ),
});

const at = <P extends string>(path: P, component: RouteComponent) => createRoute({ getParentRoute: () => root, path, component });

// Everything but the home page loads on demand (the prerendered page is hydrated only once its chunk has loaded).
// React Query and the Link TV crypto load only with /download and /link.
const download = at("/download", lazyRouteComponent(() => import("./pages/DownloadRoute.tsx"), "DownloadRoute"));
const setup = at("/setup", lazyRouteComponent(() => import("./pages/Setup.tsx"), "Setup"));
const features = at("/features", lazyRouteComponent(() => import("./pages/Features.tsx"), "Features"));
const faq = at("/faq", lazyRouteComponent(() => import("./pages/Faq.tsx"), "Faq"));
const privacy = at("/privacy", lazyRouteComponent(() => import("./pages/Privacy.tsx"), "Privacy"));
const terms = at("/terms", lazyRouteComponent(() => import("./pages/Terms.tsx"), "Terms"));
const link = at("/link", lazyRouteComponent(() => import("./pages/LinkRoute.tsx"), "LinkRoute"));

const routeTree = root.addChildren([at("/", Home), features, download, setup, faq, privacy, terms, link]);

export const createAppRouter = (opts: { history?: RouterHistory; isServer?: boolean } = {}) =>
  createRouter({ routeTree, defaultNotFoundComponent: NotFound, defaultPreload: "intent", ...opts });

type AppRouter = ReturnType<typeof createAppRouter>;

declare module "@tanstack/react-router" {
  interface Register { router: AppRouter }
}
