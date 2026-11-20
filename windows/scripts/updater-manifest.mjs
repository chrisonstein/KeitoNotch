// Writes latest.json for the Tauri updater from the signed NSIS build (run in CI after `tauri build`).
//   node scripts/updater-manifest.mjs <version> <github-repo> <tag>
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [version, repo, tag] = process.argv.slice(2);
if (!version || !repo || !tag) throw new Error("usage: updater-manifest.mjs <version> <repo> <tag>");
const dir = "src-tauri/target/release/bundle/nsis";
const exe = readdirSync(dir).find((f) => f.endsWith("-setup.exe") && f.includes(version));
if (!exe) throw new Error(`no NSIS installer for ${version} in ${dir}`);
const signature = readFileSync(join(dir, `${exe}.sig`), "utf8").trim();
const notesFile = `release-notes/${version}.md`;
let notes = `Keito Notch ${version}`;
try { notes = readFileSync(notesFile, "utf8").trim(); } catch { /* optional */ }
const manifest = {
  version,
  notes,
  pub_date: new Date().toISOString(),
  platforms: {
    "windows-x86_64": {
      signature,
      url: `https://github.com/${repo}/releases/download/${tag}/${encodeURIComponent(exe)}`,
    },
  },
};
writeFileSync("latest.json", JSON.stringify(manifest, null, 2));
console.log(`latest.json → ${manifest.platforms["windows-x86_64"].url}`);
