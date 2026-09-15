import { watch } from "node:fs";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { syncLocal } from "./local-sync.mjs";

const execute = promisify(execFile);
const [contentRoot, guideId, stateDirectory] = process.argv.slice(2);
if (!contentRoot || !guideId || !stateDirectory) throw new Error("Usage: pnpm authoring:watch-local CONTENT_ROOT GUIDE_ID STATE_DIRECTORY");
const root = resolve(contentRoot);
const state = resolve(stateDirectory);
const output = resolve(root, "_local/platform-packages");
await mkdir(state, { recursive: true });
let running = false;
let pending = true;
let timer;
let retryCount = 0;
async function sync() {
  if (running) return;
  running = true;
  try {
    while (pending) {
      pending = false;
      const started = performance.now();
      try {
        const { stdout } = await execute("uv", ["run", "python", "tools/content.py", "export-platform", "--guide", guideId, "--output", output], { cwd: root, maxBuffer: 1024 * 1024, timeout: 120_000 });
        const packagePath = resolve(stdout.trim(), "package.json");
        const report = await syncLocal(packagePath, state);
        retryCount = 0;
        console.log(JSON.stringify({ time: new Date().toISOString(), status: "synced", applied: report.applied, unchanged: report.unchanged, elapsedMs: Math.round(performance.now() - started), programmeUrl: report.guides[0]?.programmeUrl, notices: report.notices.length }));
      } catch (error) {
        console.error(JSON.stringify({ time: new Date().toISOString(), status: "error", message: error.message }));
        if (retryCount < 3 && (error.status === undefined || error.status >= 500 || [408, 429].includes(error.status))) {
          retryCount++;
          clearTimeout(timer);
          timer = setTimeout(() => { pending = true; void sync(); }, 5_000 * retryCount);
        }
      }
    }
  } finally { running = false; }
}
const watcher = watch(root, { recursive: true }, (_, filename) => {
  const path = String(filename ?? "");
  if (!/^(guides|materials|assets)\//u.test(path) || path.split("/").some((part) => part.startsWith("."))) return;
  pending = true;
  retryCount = 0;
  clearTimeout(timer);
  timer = setTimeout(sync, 500);
});
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => { watcher.close(); clearTimeout(timer); process.exit(0); });
await sync();
