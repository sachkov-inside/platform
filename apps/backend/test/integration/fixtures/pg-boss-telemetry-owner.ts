import {
  launchQueueTelemetryProcess,
  boundedProcessFact,
} from "../setup/queue-telemetry-process.js";
import { z } from "zod";

const owned = launchQueueTelemetryProcess({
  databaseUrl: "unused",
  endpoint: "unused",
  mode: "ownership",
});
try {
  const state = z
    .object({ pid: z.number(), port: z.number() })
    .parse(await boundedProcessFact(owned.firstMessage));
  process.stdout.write(
    `${JSON.stringify({ ...state, supervisorPid: owned.child.pid })}\n`,
  );
  await boundedProcessFact(owned.exited);
} finally {
  await owned.stop();
}
