import { spawn, execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * "Open in VLC" for a dead channel. The stream URL is resolved in the main process and
 * handed straight to VLC — it never travels through the renderer, keeping the credential
 * boundary intact (the URL embeds the Xtream username/password).
 */

let cachedVlcPath: string | null | undefined;

function standardVlcPaths(): string[] {
  const programFiles = process.env["ProgramFiles"];
  const programFilesX86 = process.env["ProgramFiles(x86)"];
  const paths: string[] = [];
  if (programFiles) paths.push(join(programFiles, "VideoLAN", "VLC", "vlc.exe"));
  if (programFilesX86) paths.push(join(programFilesX86, "VideoLAN", "VLC", "vlc.exe"));
  return paths;
}

async function vlcFromRegistry(): Promise<string | null> {
  for (const key of [
    "HKLM\\SOFTWARE\\VideoLAN\\VLC",
    "HKLM\\SOFTWARE\\WOW6432Node\\VideoLAN\\VLC",
  ]) {
    try {
      const { stdout } = await execFileAsync("reg", ["query", key, "/v", "InstallDir"]);
      const match = /InstallDir\s+REG_SZ\s+(.+)/i.exec(stdout);
      const dir = match?.[1]?.trim();
      if (dir) {
        const exe = join(dir, "vlc.exe");
        if (existsSync(exe)) return exe;
      }
    } catch {
      // key absent — try the next
    }
  }
  return null;
}

/** Locates vlc.exe once and caches the result (including "not found"). */
export async function findVlc(): Promise<string | null> {
  if (cachedVlcPath !== undefined) return cachedVlcPath;

  const fromDisk = standardVlcPaths().find((path) => existsSync(path));
  cachedVlcPath = fromDisk ?? (await vlcFromRegistry());
  return cachedVlcPath;
}

export async function isVlcAvailable(): Promise<boolean> {
  return (await findVlc()) !== null;
}

/** Launches VLC on `streamUrl`, detached so it outlives this process. Throws if VLC isn't installed. */
export async function openInVlc(streamUrl: string): Promise<void> {
  const vlc = await findVlc();
  if (!vlc) throw new Error("VLC isn't installed, or couldn't be found in the usual location.");
  const child = spawn(vlc, [streamUrl], { detached: true, stdio: "ignore", windowsHide: false });
  child.unref();
}
