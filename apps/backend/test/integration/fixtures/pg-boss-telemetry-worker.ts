import { createServer } from "node:net";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { context, propagation } from "@opentelemetry/api";
import { PgBoss, type JobWithMetadata } from "pg-boss";
import { z } from "zod";
import {
  observeJob,
  writeLog,
} from "../../../src/infrastructure/observability/index.js";
import { technicalTelemetryFromEnvironment } from "../../../src/infrastructure/observability/technical-telemetry-runtime.js";

const input = z
  .object({
    databaseUrl: z.string(),
    endpoint: z.string(),
    mode: z.enum(["produce", "crash", "retry", "ownership"]),
  })
  .parse(JSON.parse(process.env["PG_BOSS_TELEMETRY_FIXTURE"] ?? ""));
const COMPLETION_DEADLINE_MS = 20_000;
const COMPLETION_POLL_INTERVAL_MS = 50;
const send = (value: unknown) =>
  process.stdout.write(`${JSON.stringify(value)}\n`);
if (input.mode === "ownership") {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (address === null || typeof address === "string")
    throw new Error("fixture listener unavailable");
  process.on("SIGTERM", () => undefined);
  send({ kind: "ownership", pid: process.pid, port: address.port });
  await new Promise<void>(() => undefined);
}
const queue = "material-assets.cleanup";
const telemetry = technicalTelemetryFromEnvironment({
  environment: {
    INSIDE_OTEL_ENABLED: "true",
    INSIDE_OTEL_ENDPOINT: input.endpoint,
  },
  service: "platform-material-assets-worker",
  mode: "test",
  identity: { release: "queue-proof", sourceSha: "queue-proof" },
});
let ownedBoss: PgBoss | undefined;
try {
  const boss = (ownedBoss = new PgBoss({
    connectionString: input.databaseUrl,
    openTelemetry: telemetry.pgBoss([queue]),
    superviseIntervalSeconds: 1,
    monitorIntervalSeconds: 1,
  }));
  await boss.start();
  if (input.mode === "produce") {
    await boss.createQueue(queue, {
      expireInSeconds: 2,
      retryLimit: 3,
      retryDelay: 0,
    });
    const request = telemetry.startHttp({
      method: "POST",
      route: "/queue-proof",
    });
    const jobId = await request.run(() =>
      context.with(
        propagation.setBaggage(
          context.active(),
          propagation.createBaggage({ private: { value: "sentinel-baggage" } }),
        ),
        () => boss.send(queue, { private: "sentinel-payload" }),
      ),
    );
    request.finish(200, 1);
    send({ kind: "produced", jobId, ...telemetry.correlation() });
  } else {
    let finishedId: string | undefined;
    await boss.work(
      queue,
      { pollingIntervalSeconds: 0.5, includeMetadata: true },
      observeJob(
        "material-assets-worker",
        queue,
        async ([job]: readonly JobWithMetadata<unknown>[]) => {
          if (job === undefined) throw new Error("missing fixture job");
          writeLog("info", "queue_attempt");
          send({
            kind: "attempt",
            pid: process.pid,
            jobId: job.id,
            retryCount: job.retryCount,
            ...telemetry.correlation(),
          });
          if (input.mode === "crash") {
            await new Promise<void>(() => undefined);
          }
          if (job.retryCount === 1) {
            const failure = new Error("sentinel-error-sql");
            Object.defineProperty(failure, "constructor", {
              value: { name: "sentinel-constructor" },
            });
            throw failure;
          }
          finishedId = job.id;
        },
        telemetry,
      ),
    );
    const deadline = performance.now() + COMPLETION_DEADLINE_MS;
    for (;;) {
      if (
        finishedId !== undefined &&
        (await boss.findJobs(queue, { id: finishedId }))[0]?.state ===
          "completed"
      )
        break;
      if (performance.now() >= deadline)
        throw new Error("fixture completion deadline");
      // deterministic-test-allow duration-wait: Observe durable queue completion; interval is not the assertion.
      await delay(COMPLETION_POLL_INTERVAL_MS);
    }
  }
} finally {
  try {
    await ownedBoss?.stop({ close: true, graceful: false });
  } finally {
    try {
      await telemetry.shutdown();
    } finally {
      process.disconnect?.();
    }
  }
}
