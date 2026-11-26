// Connects remote.ts to the running app: takes queued requests from Rust (src-tauri/src/remote.rs), runs
// them one at a time on the real store, and writes the reply for scripts/keito.ps1.
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { decodeRequest, runRemote, type RemoteReply } from "./remote";
import { reportProblem } from "./problems";
import { store } from "./store";

let chain: Promise<void> = Promise.resolve();

async function handle(raw: string) {
  const d = decodeRequest(raw);
  let reply: RemoteReply;
  if (!d.ok) {
    // Without an id there's no file to answer in; the script times out and says so.
    if (!d.id) {
      reportProblem("remote", `request dropped: ${d.error}`);
      return;
    }
    reply = { id: d.id, ok: false, message: d.error };
  } else {
    reply = await runRemote(d.request, store);
  }
  await invoke("remote_reply", { id: reply.id, json: JSON.stringify(reply) }).catch((e) =>
    reportProblem("remote", `reply ${reply.id} not written: ${String(e)}`));
}

/** Takes whatever Rust queued and runs it after what's already running: one command at a time. */
function drain() {
  chain = chain.then(async () => {
    const queued = await invoke<string[]>("take_pending_remote").catch(() => [] as string[]);
    for (const raw of queued) await handle(raw);
  });
}

/**
 * Starts listening once the store has loaded (`ready`), so a command never sees an empty timer or a missing
 * ticket history. Requests that came in before (cold start, or while the UI remounted after a crash) wait in
 * the Rust queue and run now. Returns the clean-up.
 */
export function startRemote(ready: Promise<unknown>): () => void {
  let stopped = false;
  let off: (() => void) | null = null;
  void ready
    .catch(() => undefined)
    .then(() => listen("remote-command", drain))
    .then((unlisten) => {
      if (stopped) unlisten();
      else {
        off = unlisten;
        drain();
      }
    });
  return () => {
    stopped = true;
    off?.();
  };
}
