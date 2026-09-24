import { Platform } from "react-native";
import * as Application from "expo-application";
import { File, Paths } from "expo-file-system";
import { getContentUriAsync } from "expo-file-system/legacy";
import * as IntentLauncher from "expo-intent-launcher";

/**
 * Sideloaded apps get no store updates, so the app updates itself: it reads a small manifest, and if
 * that names a newer build, downloads the APK and hands it to Android's installer (ADR 0010).
 * The sync worker serves the files from its RELEASES bucket. Leave empty to switch updates off.
 */
export const UPDATE_BASE_URL: string = "https://testcard-sync.evcalex.workers.dev/app";

export interface UpdateInfo {
  readonly versionCode: number;
  readonly versionName: string;
  readonly apkUrl: string;
}

interface Manifest {
  readonly versionCode: number;
  readonly versionName: string;
  readonly apks: Readonly<Record<string, string>>;
}

export const updatesConfigured = () => UPDATE_BASE_URL !== "";
export const installedVersion = () => ({ code: Number(Application.nativeBuildVersion ?? 0), name: Application.nativeApplicationVersion ?? "0" });

/** The newer build for this kind of device, or null when this one is current. */
export async function checkForUpdate(): Promise<UpdateInfo | null> {
  const response = await fetch(`${UPDATE_BASE_URL}/latest.json`, { headers: { "cache-control": "no-cache" } });
  if (!response.ok) throw new Error(`The update check failed (${response.status}).`);
  const manifest = (await response.json()) as Manifest;
  const apk = manifest.apks[Platform.isTV ? "firetv" : "phone"];
  if (apk === undefined || manifest.versionCode <= installedVersion().code) return null;
  return { versionCode: manifest.versionCode, versionName: manifest.versionName, apkUrl: apk.startsWith("http") ? apk : `${UPDATE_BASE_URL}/${apk}` };
}

/** Downloads the APK, then opens Android's installer on it. The app is replaced once the user confirms. */
export async function downloadAndInstall(info: UpdateInfo, onProgress: (fraction: number) => void): Promise<void> {
  const file = new File(Paths.cache, "testcard-update.apk");
  if (file.exists) file.delete();
  const task = File.createDownloadTask(info.apkUrl, file, {
    onProgress: ({ bytesWritten, totalBytes }) => onProgress(totalBytes > 0 ? bytesWritten / totalBytes : 0),
  });
  const downloaded = await task.downloadAsync();
  if (downloaded === null || downloaded === undefined) throw new Error("The download did not finish.");
  const contentUri = await getContentUriAsync(file.uri);
  await IntentLauncher.startActivityAsync("android.intent.action.VIEW", {
    data: contentUri,
    type: "application/vnd.android.package-archive",
    // The installer opens in a task of its own (FLAG_ACTIVITY_NEW_TASK), not on top of this app. In this app's task,
    // the replaced app's dead screen stayed under it and came back half-alive after the install, needing a force stop.
    flags: 0x1 | 0x10000000, // FLAG_GRANT_READ_URI_PERMISSION | FLAG_ACTIVITY_NEW_TASK
  });
}
