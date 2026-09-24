import { requireOptionalNativeModule } from "expo";

/**
 * Installs an update APK with Android's package installer session: the app asks once ("Install this update?") and
 * is replaced. Unlike handing the file to whatever opens APKs, it reports what happened, so a refusal is shown rather
 * than nothing happening. Absent (null) in a build made before it existed.
 */
interface InstallerModule {
  /** Whether Android lets this app install updates ("Install unknown apps" allowed for Testcard). */
  canInstall(): boolean;
  /** Opens the setting that allows it: this app's own page where there is one, else the security settings. */
  openInstallSetting(): boolean;
  /**
   * Streams the APK at `path` (a file:// URI or a plain path) into an install session and commits it. Resolves once
   * Android has asked the viewer to confirm, or with an error saying why it would not.
   */
  install(path: string): Promise<void>;
}

export const Installer = requireOptionalNativeModule<InstallerModule>("TestcardInstaller");
