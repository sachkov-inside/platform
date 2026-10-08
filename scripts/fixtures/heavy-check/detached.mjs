import { spawn } from "node:child_process";
const child = spawn(process.execPath, ["-e", "process.on('SIGTERM', () => {}); console.log('DETACHED', process.pid); setInterval(() => {}, 1000)"], {
  detached: true, stdio: ["ignore", "inherit", "inherit"],
});
child.on("spawn", () => console.log("READY", process.pid));
setInterval(() => {}, 1000);
