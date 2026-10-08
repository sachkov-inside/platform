// @ts-check
import { spawnOwned, stopOwned } from "./owned-process.mjs";
import { commandExit } from "./diagnostic-command.mjs";

const args = process.argv.slice(2);
const command =
  args[0] === "--command" ? args.splice(0, 2)[1] : process.execPath;
if (command === undefined) throw new Error("--command requires an executable");
/** @type {NodeJS.Signals | undefined} */
let interruptedSignal;
for (const signal of /** @type {const} */ (["SIGINT", "SIGTERM"])) {
  process.once(signal, () => {
    interruptedSignal ??= signal;
    void stopOwned(child);
  });
}
const child = spawnOwned(command, args, {
  stdio: "inherit",
});
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
