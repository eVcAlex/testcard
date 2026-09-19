import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { checkForUpdate, downloadAndInstall, updatesConfigured, type UpdateInfo } from "./update";

type Phase = "idle" | "checking" | "downloading" | "error";

interface UpdateState {
  readonly configured: boolean;
  readonly available: UpdateInfo | null;
  readonly phase: Phase;
  /** 0 to 1 while downloading. */
  readonly progress: number;
  readonly error: string | undefined;
  /** True once a check has completed, so "up to date" is not claimed before one has run. */
  readonly checked: boolean;
  check(): void;
  install(): void;
}

const UpdateContext = createContext<UpdateState | undefined>(undefined);

export function UpdateProvider({ children }: { children: ReactNode }) {
  const [available, setAvailable] = useState<UpdateInfo | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | undefined>(undefined);
  const [checked, setChecked] = useState(false);
  const configured = updatesConfigured();

  const check = useCallback(() => {
    if (!configured) return;
    setPhase("checking");
    setError(undefined);
    checkForUpdate()
      .then((info) => {
        setAvailable(info);
        setChecked(true);
        setPhase("idle");
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : "The update check failed.");
        setPhase("error");
      });
  }, [configured]);

  const install = useCallback(() => {
    if (available === null) return;
    setPhase("downloading");
    setProgress(0);
    setError(undefined);
    downloadAndInstall(available, setProgress)
      .then(() => setPhase("idle"))
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : "The update failed.");
        setPhase("error");
      });
  }, [available]);

  // A launch is the natural moment to look; a failed check is quiet here and visible on Sources.
  useEffect(check, [check]);

  const value = useMemo(() => ({ configured, available, phase, progress, error, checked, check, install }), [configured, available, phase, progress, error, checked, check, install]);
  return <UpdateContext.Provider value={value}>{children}</UpdateContext.Provider>;
}

export function useUpdate(): UpdateState {
  const value = useContext(UpdateContext);
  if (value === undefined) throw new Error("useUpdate needs an UpdateProvider");
  return value;
}
