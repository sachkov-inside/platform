// @ts-check
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const [report, id, mode, image] = process.argv.slice(2);
if (report === undefined || id === undefined || mode === undefined || image === undefined) throw Error("Lease fixture requires four arguments");
const watchdog = spawn(process.execPath, [fileURLToPath(new URL("../watchdog.mjs", import.meta.url)), report], { detached: true, stdio: ["pipe", "ignore", "inherit"] });
watchdog.stdin.write(JSON.stringify({ labId: id }) + "\n");
const child = spawn(process.execPath, [fileURLToPath(new URL("../command-wrapper.mjs", import.meta.url)), id], { detached: true, stdio: ["pipe", "ignore", "inherit"] });
if (child.pid === undefined) throw Error("No command PID");
watchdog.stdin.write(JSON.stringify({ processGroup: child.pid, leaseToken: id }) + "\n");
child.stdin.end(JSON.stringify({ program: "docker", args: ["run", "-d", "--rm", "--network", "none", "--label", `inside.chapter-lab=${id}`, image, "timeout", "300", "sleep", "infinity"] }));
child.once("close", (code) => {
  if (code !== 0) { watchdog.stdin.end(); process.exitCode = 1; return; }
  watchdog.stdin.write(JSON.stringify({ finishedGroup: child.pid }) + "\n");
  process.stdout.write("ready\n");
  if (mode === "success" || mode === "failure") { watchdog.stdin.end(); process.exitCode = mode === "success" ? 0 : 1; }
  else process.stdin.resume();
});
