import { z } from "zod";

const input = z
  .object({
    worker: z.enum([
      "profile-avatars-worker",
      "video-deletions-worker",
      "billing-worker",
    ]),
  })
  .parse(JSON.parse(process.env["PG_BOSS_TELEMETRY_FIXTURE"] ?? "null"));
console.log(JSON.stringify({ kind: "worker", pid: process.pid }));
switch (input.worker) {
  case "profile-avatars-worker":
    await import("../../../src/entrypoints/profile-avatars-worker.js");
    break;
  case "video-deletions-worker":
    await import("../../../src/entrypoints/video-deletions-worker.js");
    break;
  case "billing-worker":
    await import("../../../src/entrypoints/billing-worker.js");
    break;
}
