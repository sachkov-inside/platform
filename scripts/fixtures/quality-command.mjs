// @ts-check
import { spawn } from "node:child_process";

const mode = process.argv[2];
const descendant = spawn(
  process.execPath,
  ["-e", "process.on('SIGTERM',()=>{});setInterval(()=>{},1000);process.send(process.pid)"],
  { detached: true, stdio: ["ignore", "ignore", "ignore", "ipc"] },
);
descendant.once("message", (pid) => {
  console.log(JSON.stringify({ owner: process.pid, descendant: pid }));
  if (mode === "success") process.exit(0);
  if (mode === "failure") process.exit(7);
  if (mode === "interruption") process.kill(process.pid, "SIGTERM");
});
setInterval(() => {}, 1000);
