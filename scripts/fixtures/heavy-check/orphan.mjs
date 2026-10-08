import { spawn } from "node:child_process";
console.log("READY", process.pid, process.env.INSIDE_HEAVY_CHECK_OWNER);
process.stdin.once("data", () => {
  const child = spawn(process.execPath, ["-e", "console.log('ORPHAN', process.pid); setInterval(() => {}, 1000)"], {
    stdio: ["ignore", "inherit", "inherit"],
  });
  child.unref();
  child.once("spawn", () => process.exit(0));
});
