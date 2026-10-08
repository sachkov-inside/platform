// @ts-check
import { spawnOwned, stopOwned } from "./owned-process.mjs";
import { commandExit } from "./diagnostic-command.mjs";

const child = spawnOwned(process.execPath, process.argv.slice(2), {
  stdio: "inherit",
});
/** @type {NodeJS.Signals | undefined} */
let interruptedSignal;
for (const signal of /** @type {const} */ (["SIGINT", "SIGTERM"])) {
  process.once(signal, () => {
    interruptedSignal ??= signal;
    void stopOwned(child);
  });
}
try {
  const status = await commandExit(child);
  process.exitCode =
    interruptedSignal === "SIGINT"
      ? 130
      : interruptedSignal === "SIGTERM"
        ? 143
        : (status ?? 1);
} finally {
  await stopOwned(child);
}
