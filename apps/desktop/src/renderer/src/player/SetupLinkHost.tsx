import { useCallback, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import type { SetupOutcome } from "../../../shared/ipc.js";

/** Fired by the paste form once it has opened a link, so the question below appears the same way it does for a link the system opened. */
export const SETUP_CHECK_EVENT = "testcard:setup-check";

type Shown = SetupOutcome | { readonly kind: "done"; readonly title: string; readonly message: string };

/**
 * The one place a shared source is accepted. It shows the name and the provider's host (never a login) and asks; nothing is
 * added until the person says yes. Mounted once for the whole window, so a link opens the same question wherever they are.
 */
export function SetupLinkHost() {
  const queryClient = useQueryClient();
  const [shown, setShown] = useState<Shown | null>(null);
  const [busy, setBusy] = useState(false);

  const check = useCallback(() => {
    void window.testcard.setup.pending().then((outcome) => {
      if (outcome !== null) setShown(outcome);
    });
  }, []);

  useEffect(() => {
    check();
    window.addEventListener(SETUP_CHECK_EVENT, check);
    const off = window.testcard.events.onSetup(check);
    return () => {
      window.removeEventListener(SETUP_CHECK_EVENT, check);
      off();
    };
  }, [check]);

  if (shown === null) return null;
  const close = () => setShown(null);

  if (shown.kind === "error") {
    return <ConfirmDialog title="Couldn't open the link" body={shown.message} confirmLabel="OK" onCancel={close} onConfirm={close} />;
  }
  if (shown.kind === "done") {
    return <ConfirmDialog title={shown.title} body={shown.message} confirmLabel="OK" onCancel={close} onConfirm={close} />;
  }

  const { id, summary } = shown;
  const what = summary.kind === "xtream" ? "a provider login" : "a playlist";
  return (
    <ConfirmDialog
      title={`Add "${summary.name}"?`}
      body={`Someone shared ${what} on ${summary.host || "a provider"} with you. Adding it puts it in your Sources and loads its channels${summary.epgOptimise ? ", with improved TV guide matching" : ""}. Only add it if you trust whoever sent the link.`}
      confirmLabel={busy ? "Adding…" : "Add source"}
      busy={busy}
      onCancel={() => {
        void window.testcard.setup.cancel(id);
        close();
      }}
      onConfirm={() => {
        setBusy(true);
        window.testcard.setup
          .confirm(id)
          .then((result) => {
            void queryClient.invalidateQueries({ queryKey: ["sources"] });
            setShown(
              result.status === "added"
                ? { kind: "done", title: "Source added", message: `"${result.name}" is being loaded now. It will appear in your channels in a moment.` }
                : { kind: "done", title: "You already have this", message: `"${result.name}" is already in your Sources, so nothing was added or changed.` },
            );
          })
          .catch((error: unknown) => {
            setShown({ kind: "done", title: "Couldn't add it", message: error instanceof Error ? error.message : "That source couldn't be added." });
          })
          .finally(() => setBusy(false));
      }}
    />
  );
}
