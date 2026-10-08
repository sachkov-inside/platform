import { spawnSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
const seed = { count: 0 };
test("bad fixture", async () => {
  seed.count++;
  await delay(100);
  await fetch("https://external.example");
  spawnSync("git", ["status"]);
});
