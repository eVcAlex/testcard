import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AppState } from "react-native";
import { useApp } from "../state/app";
import { canInstall, checkForUpdate, download, install as installApk, openInstallSetting, updatesConfigured, type UpdateInfo } from "./update";

/**
 * "checking" and "downloading" are what they say; "installing" is Android's installer being asked; "permission" is
 * waiting for the viewer to allow Testcard to install updates in Settings, after which the install goes on by itself.
 */
type Phase = "idle" | "checking" | "downloading" | "installing" | "permission" | "error";

interface UpdateState {
  readonly configured: boolean;
  readonly available: UpdateInfo | null;
  readonly phase: Phase;
  /** 0 to 1 while downloading. */
  readonly progress: number;
  readonly error: string | undefined;
  /** True once a check has completed, so "up to date" is not claimed before one has run. */
  readonly checked: boolean;
  /** Whether the app looks for new versions by itself (at launch and every few hours) and offers them. */
  readonly auto: boolean;
  /** Whether the "new version" dialog is up. */
  readonly prompting: boolean;
  check(): void;
  install(): void;
  setAuto(on: boolean): void;
  /** Shows the dialog for the available version (from Settings). */
  showPrompt(): void;
  /** Closes the dialog; an automatic check does not offer this version again. */
  later(): void;
  openInstallSetting(): void;
}

const UpdateContext = createContext<UpdateState | undefined>(undefined);

const AUTO_KEY = "update:auto";
const SKIPPED_KEY = "update:skipped";
/** How often an app left open, or brought back, looks again. */
const RECHECK_MS = 6 * 60 * 60 * 1000;
/** The launch check waits for the app to settle: the first seconds are for the viewer. */
const FIRST_CHECK_MS = 8000;

export function UpdateProvider({ children }: { children: ReactNode }) {
  const { db } = useApp();
  const readMeta = useCallback(
    (key: string): string | undefined => {
      try {
        return (db.prepare(`SELECT value FROM schema_meta WHERE key = ?`).get(key) as { value: string } | undefined)?.value;
      } catch {
        return undefined;
      }
    },
    [db],
  );
  const writeMeta = useCallback(
    (key: string, value: string) => {
      try {
        db.prepare(`INSERT OR REPLACE INTO schema_meta (key, value) VALUES (?, ?)`).run(key, value);
      } catch {
        // Only the next launch would miss it.
      }
    },
    [db],
  );

  const configured = updatesConfigured();
  const [available, setAvailable] = useState<UpdateInfo | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | undefined>(undefined);
  const [checked, setChecked] = useState(false);
  const [auto, setAutoState] = useState(() => readMeta(AUTO_KEY) !== "0");
  const [prompting, setPrompting] = useState(false);
  const busy = phase === "checking" || phase === "downloading" || phase === "installing";
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const lastCheck = useRef(0);

  /** `offer`: an automatic check, which opens the dialog for a version the viewer has not put off. */
  const runCheck = useCallback(
    (offer: boolean) => {
      if (!configured || busyRef.current) return;
      lastCheck.current = Date.now();
      setPhase("checking");
      setError(undefined);
      checkForUpdate()
        .then((info) => {
          setAvailable(info);
          setChecked(true);
          setPhase("idle");
          if (info !== null && offer && readMeta(SKIPPED_KEY) !== String(info.versionCode)) setPrompting(true);
        })
        .catch((cause: unknown) => {
          setError(cause instanceof Error ? cause.message : "The update check failed.");
          setPhase(offer ? "idle" : "error");
        });
    },
    [configured, readMeta],
  );
  const check = useCallback(() => runCheck(false), [runCheck]);

  const target = useRef<UpdateInfo | null>(null);
  target.current = available;
  const install = useCallback(() => {
    const info = target.current;
    if (info === null || busyRef.current) return;
    setPrompting(true);
    setError(undefined);
    if (!canInstall()) {
      setPhase("permission");
      return;
    }
    setPhase("downloading");
    setProgress(0);
    download(info, setProgress)
      .then((file) => {
        setPhase("installing");
        return installApk(file);
      })
      // Android's question is on screen; the app is replaced if the viewer says yes. If they say no, the dialog is
      // back as it was, to try again or put off.
      .then(() => setPhase("idle"))
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : "The update failed.");
        setPhase("error");
      });
  }, []);

  // Automatic checks: shortly after launch, then every few hours while open and on coming back to the app.
  useEffect(() => {
    if (!configured || !auto) return;
    const first = setTimeout(() => runCheck(true), FIRST_CHECK_MS);
    const every = setInterval(() => runCheck(true), RECHECK_MS);
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active" && Date.now() - lastCheck.current > RECHECK_MS) runCheck(true);
    });
    return () => {
      clearTimeout(first);
      clearInterval(every);
      subscription.remove();
    };
  }, [configured, auto, runCheck]);

  // Back from Settings with installs allowed: carry on with the update.
  useEffect(() => {
    if (phase !== "permission") return;
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active" && canInstall()) install();
    });
    return () => subscription.remove();
  }, [phase, install]);

  const setAuto = useCallback(
    (on: boolean) => {
      setAutoState(on);
      writeMeta(AUTO_KEY, on ? "1" : "0");
    },
    [writeMeta],
  );
  const showPrompt = useCallback(() => {
    if (target.current !== null) setPrompting(true);
  }, []);
  const later = useCallback(() => {
    setPrompting(false);
    if (target.current !== null) writeMeta(SKIPPED_KEY, String(target.current.versionCode));
    setPhase((current) => (current === "error" || current === "permission" ? "idle" : current));
  }, [writeMeta]);
  const openSetting = useCallback(() => {
    if (!openInstallSetting()) setError("Open Settings, then My Fire TV, Developer options, Install unknown apps, and turn on Testcard.");
  }, []);

  const value = useMemo(
    () => ({ configured, available, phase, progress, error, checked, auto, prompting, check, install, setAuto, showPrompt, later, openInstallSetting: openSetting }),
    [configured, available, phase, progress, error, checked, auto, prompting, check, install, setAuto, showPrompt, later, openSetting],
  );
  return <UpdateContext.Provider value={value}>{children}</UpdateContext.Provider>;
}

export function useUpdate(): UpdateState {
  const value = useContext(UpdateContext);
  if (value === undefined) throw new Error("useUpdate needs an UpdateProvider");
  return value;
}
