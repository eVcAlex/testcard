import { Platform } from "react-native";
import * as Application from "expo-application";
import { File, Paths } from "expo-file-system";
import { getContentUriAsync } from "expo-file-system/legacy";
import * as IntentLauncher from "expo-intent-launcher";
import { Installer } from "../../modules/testcard-installer";

/**
 * Sideloaded apps get no store updates, so the app updates itself: it reads a small manifest, and if
 * that names a newer build, downloads the APK and hands it to Android's installer (ADR 0010).
 * The sync worker serves the files from its RELEASES bucket. Leave empty to switch updates off.
 */
export const UPDATE_BASE_URL: string = "https://testcard-sync.evcalex.workers.dev/app";

export interface ReleaseNote {
  readonly versionName: string;
  readonly changes: readonly string[];
}

export interface UpdateInfo {
  readonly versionCode: number;
  readonly versionName: string;
  readonly apkUrl: string;
  /** What changed in each build newer than this one, newest first. Empty for a manifest from before notes. */
  readonly notes: readonly ReleaseNote[];
}

interface Manifest {
  readonly versionCode: number;
  readonly versionName: string;
  readonly apks: Readonly<Record<string, string>>;
  readonly notes?: readonly { versionCode: number; versionName: string; changes: readonly string[] }[];
}

export const updatesConfigured = () => UPDATE_BASE_URL !== "";
export const installedVersion = () => ({ code: Number(Application.nativeBuildVersion ?? 0), name: Application.nativeApplicationVersion ?? "0" });

/** The newer build for this kind of device, or null when this one is current. */
export async function checkForUpdate(): Promise<UpdateInfo | null> {
  const response = await withTimeout(fetch(`${UPDATE_BASE_URL}/latest.json`, { headers: { "cache-control": "no-cache" } }), 20_000);
  if (!response.ok) throw new Error(`The update check failed (${response.status}).`);
  const manifest = (await response.json()) as Manifest;
  const apk = manifest.apks[Platform.isTV ? "firetv" : "phone"];
  const installed = installedVersion().code;
  if (apk === undefined || manifest.versionCode <= installed) return null;
  const notes = (manifest.notes ?? [])
    .filter((entry) => entry.versionCode > installed && Array.isArray(entry.changes) && entry.changes.length > 0)
    .map((entry) => ({ versionName: entry.versionName, changes: entry.changes }));
  return { versionCode: manifest.versionCode, versionName: manifest.versionName, apkUrl: apk.startsWith("http") ? apk : `${UPDATE_BASE_URL}/${apk}`, notes };
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("The update server took too long to answer.")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/** Whether Android lets Testcard install its updates. True where that cannot be asked (an older build's native side). */
export const canInstall = () => Installer?.canInstall() ?? true;
/** Opens the setting that allows it. */
export const openInstallSetting = () => Installer?.openInstallSetting() ?? false;

/** A download that has not moved for this long is given up, rather than sitting at one percentage for good. */
const STALL_MS = 45_000;

const apkFile = (info: UpdateInfo) => new File(Paths.cache, `testcard-${info.versionCode}.apk`);

/**
 * Downloads the APK, once: a finished download is kept, so a second try (after allowing installs, say) goes straight
 * to the installer. Written under another name until it is whole, so a cut-off download is never taken for one.
 */
export async function download(info: UpdateInfo, onProgress: (fraction: number) => void): Promise<File> {
  const file = apkFile(info);
  if (file.exists && file.size > 0) {
    onProgress(1);
    return file;
  }
  for (const old of Paths.cache.list()) if (old instanceof File && /^testcard-.*\.apk(\.part)?$/.test(old.name)) old.delete();
  const part = new File(Paths.cache, `testcard-${info.versionCode}.apk.part`);
  const abort = new AbortController();
  let moved = Date.now();
  const watchdog = setInterval(() => {
    if (Date.now() - moved > STALL_MS) abort.abort();
  }, 5000);
  try {
    const task = File.createDownloadTask(info.apkUrl, part, {
      signal: abort.signal,
      onProgress: ({ bytesWritten, totalBytes }) => {
        moved = Date.now();
        onProgress(totalBytes > 0 ? bytesWritten / totalBytes : 0);
      },
    });
    const downloaded = await task.downloadAsync().catch((error: unknown) => {
      throw abort.signal.aborted ? new Error("The download stopped moving. Check the connection and try again.") : error;
    });
    if (downloaded === null || !part.exists || part.size === 0) throw new Error("The download did not finish.");
    part.move(file);
    return file;
  } finally {
    clearInterval(watchdog);
    if (part.exists) part.delete();
  }
}

/**
 * Hands the downloaded APK to Android's package installer, which asks the viewer to confirm and then replaces the
 * app. Resolves once that question is on screen; rejects with why, when Android says no.
 */
export async function install(file: File): Promise<void> {
  if (Installer !== null) {
    await Installer.install(file.uri);
    return;
  }
  // A build from before the installer module: the old way, which cannot tell whether the installer opened.
  const contentUri = await getContentUriAsync(file.uri);
  void IntentLauncher.startActivityAsync("android.intent.action.VIEW", {
    data: contentUri,
    type: "application/vnd.android.package-archive",
    flags: 0x1 | 0x10000000, // FLAG_GRANT_READ_URI_PERMISSION | FLAG_ACTIVITY_NEW_TASK
  }).catch(() => undefined);
}
