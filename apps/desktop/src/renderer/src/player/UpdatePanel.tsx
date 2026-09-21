import { useEffect, useState } from "react";
import type { UpdateState } from "../../../shared/ipc.js";
import { Icon } from "../components/Icon.js";
import { formatRelative } from "../lib/time.js";

/** The update state, kept current by the events main pushes while a check or download runs. */
export function useUpdateState(): UpdateState | undefined {
  const [state, setState] = useState<UpdateState | undefined>();
  useEffect(() => {
    let live = true;
    void window.testcard.update.state().then((initial) => {
      if (live) setState(initial);
    });
    const stop = window.testcard.events.onUpdate((next) => setState(next));
    return () => {
      live = false;
      stop();
    };
  }, []);
  return state;
}

function summary(state: UpdateState): string {
  switch (state.status) {
    case "dev":
      return "Updates are off while running from source";
    case "checking":
      return "Checking for updates…";
    case "available":
      return `Version ${state.latest} is available`;
    case "downloading":
      return `Downloading version ${state.latest}… ${state.percent ?? 0}%`;
    case "ready":
      return `Version ${state.latest} is ready to install`;
    case "error":
      return "Couldn't check for updates";
    default:
      return state.checkedAt !== undefined ? `You're up to date. Checked ${formatRelative(state.checkedAt)}` : "You're up to date";
  }
}

/** Version, and a way to check, download and install a newer one from the release bucket. */
export function UpdatePanel() {
  const state = useUpdateState();
  if (state === undefined) return null;
  const working = state.status === "checking" || state.status === "downloading";
  return (
    <section className="pw-panel">
      <div className="pw-panel-head">
        <h3>Updates</h3>
      </div>
      <div className="pw-sync-summary">
        <div className="pw-sync-who">
          <span className="pw-sync-email">{`Testcard ${state.current}`}</span>
          <span className="pw-sync-state" data-state={state.status === "error" ? "error" : working ? "busy" : state.status === "available" || state.status === "ready" ? "ok" : "off"}>
            <i aria-hidden="true" />
            {summary(state)}
          </span>
        </div>
        <div className="pw-sync-actions">
          {state.status === "available" && (
            <button type="button" className="btn btn--primary" onClick={() => void window.testcard.update.download()}>
              Download
            </button>
          )}
          {state.status === "ready" && (
            <button type="button" className="btn btn--primary" onClick={() => void window.testcard.update.install()}>
              Restart to update
            </button>
          )}
          {state.status !== "available" && state.status !== "ready" && (
            <button type="button" className="btn btn--ghost" disabled={working || state.status === "dev"} onClick={() => void window.testcard.update.check()}>
              <Icon name="refresh" /> Check for updates
            </button>
          )}
        </div>
      </div>
      {state.status === "error" && state.message !== undefined && <p className="msg msg--error">{state.message}</p>}
    </section>
  );
}
