import { spawnSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
const seed = { count: 0 };
it.each([{ messageId: crypto.randomUUID() }])("binding %j", () => {});
test("bad fixture", async () => {
  const _today = new Date();
  seed.count++;
  await delay(100);
  await fetch("https://external.example");
  spawnSync("git", ["status"]);
});
