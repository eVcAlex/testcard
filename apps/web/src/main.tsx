import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import "@testcard/theme/tokens.css";
import "./styles.css";
import { createAppRouter } from "./router.tsx";

async function start() {
  const container = document.getElementById("root")!;
  const router = createAppRouter();
  // Load the matched route (including lazy chunks) first, so the first client render equals the prerendered HTML.
  await router.load();
  const hydrating = container.firstElementChild !== null;
  // Server markup is rendered without a <Suspense> around the matches; telling the router the page came from the
  // server (as TanStack Start does) makes the client skip it too, so hydration lines up.
  if (hydrating) router.ssr = { manifest: undefined };
  const app = <StrictMode><RouterProvider router={router} /></StrictMode>;
  // The dev server serves an empty shell; a built page has markup to hydrate.
  if (hydrating) hydrateRoot(container, app);
  else createRoot(container).render(app);
}

void start();
