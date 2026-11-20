// Auto-update from GitHub Releases (Tauri updater; signed with the key from `tauri signer generate`).
// The feed is the `windows-updates` release's latest.json, separate from the Mac app's appcast.
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { loadPrefs, savePrefs } from "./prefs";

const DAY = 24 * 3600_000;

export async function checkForUpdate(): Promise<Update | null> {
  const update = await check();
  savePrefs({ lastUpdateCheck: Date.now() });
  return update;
}

/** Downloads, runs the installer (passive) and restarts the app. */
export async function installUpdate(update: Update): Promise<void> {
  await update.downloadAndInstall();
  await relaunch();
}

/**
 * The daily check, run from the notch window (always open). With automatic install it updates quietly;
 * otherwise `offer` shows the "Install" toast.
 */
export function startDailyChecks(offer: (update: Update) => void): () => void {
  const run = async () => {
    const p = loadPrefs();
    if (!p.autoUpdateCheck || Date.now() - p.lastUpdateCheck < DAY) return;
    try {
      const update = await checkForUpdate();
      if (!update) return;
      if (p.autoInstall) await installUpdate(update);
      else offer(update);
    } catch {
      // Offline or no release yet: try again later.
    }
  };
  const first = window.setTimeout(run, 30_000);
  const timer = window.setInterval(run, 3600_000);
  return () => {
    window.clearTimeout(first);
    window.clearInterval(timer);
  };
}
