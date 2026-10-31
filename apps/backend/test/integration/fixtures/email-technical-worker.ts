import "reflect-metadata";
import { createInterface } from "node:readline";
import { NestFactory } from "@nestjs/core";
import { z } from "zod";
import { NotificationsWorkerModule } from "../../../src/entrypoints/notifications-worker/notifications-worker.module.js";
import { assembleNotificationPipeline } from "../../../src/entrypoints/notifications-worker/assemble-notification-pipeline.js";
import {
  PLATFORM_CONFIG,
  type PlatformConfig,
} from "../../../src/config/platform-config.js";
import { PrismaClientProvider } from "../../../src/infrastructure/prisma/index.js";
import { technicalTelemetryFromEnvironment } from "../../../src/infrastructure/observability/technical-telemetry-runtime.js";
import {
  RUNTIME_IDENTITY,
  type RuntimeIdentity,
} from "../../../src/infrastructure/runtime-identity.js";
import {
  generateRequestId,
  runWithLogContext,
  writeLog,
} from "../../../src/infrastructure/observability/index.js";
import {
  Notifications,
  assembleNotificationEmailSender,
  type SendNotificationEmail,
} from "../../../src/modules/notifications/index.js";
import { finishFixtureCleanup } from "../setup/queue-telemetry-process.js";

const input = z
  .object({
    phase: z.enum([
      "normal",
      "before-smtp",
      "after-smtp",
      "before-result-ack",
      "legacy-command",
    ]),
  })
  .parse(JSON.parse(process.env["PG_BOSS_TELEMETRY_FIXTURE"] ?? "null"));
const send = (record: Readonly<Record<string, unknown>>) =>
  process.stdout.write(`${JSON.stringify({ pid: process.pid, ...record })}\n`);
// These wrappers only stop at owner boundaries. They never substitute an SMTP outcome or a broker confirm.
const pause = () => new Promise<never>(() => undefined);
const isSent = (payload: string) =>
  z.object({ state: z.literal("sent") }).safeParse(JSON.parse(payload)).success;
const commands = createInterface({ input: process.stdin });
const stop = new Promise<void>((resolve) => {
  commands.on("line", (command) => {
    if (command === "stop") resolve();
  });
});
const cleanup: (() => unknown)[] = [
  () => {
    commands.close();
  },
];
try {
  const app = await NestFactory.createApplicationContext(
    NotificationsWorkerModule,
    { logger: false },
  );
  cleanup.push(() => app.close());
  const telemetry = technicalTelemetryFromEnvironment({
    environment: process.env,
    service: "platform-notifications-worker",
    mode: "test",
    identity: app.get<RuntimeIdentity>(RUNTIME_IDENTITY),
  });
  cleanup.push(() => telemetry.shutdown());
  const config = app.get<PlatformConfig>(PLATFORM_CONFIG);
  if (!config.notifications || !config.billingContact)
    throw new Error("email fixture configuration missing");
  const notifications = app.get(Notifications);
  const actualSender = assembleNotificationEmailSender(config.billingContact);
  const sender: SendNotificationEmail = async (message) => {
    if (input.phase === "before-smtp") {
      await telemetry.flush();
      send({ kind: "before-smtp" });
      await pause();
    }
    const outcome = await actualSender(message);
    if (input.phase === "after-smtp") {
      // A sent observation means the real SMTP invocation completed, not that its local result committed.
      if (outcome.state !== "sent")
        throw new Error("SMTP acceptance not observed");
      await telemetry.flush();
      send({ kind: "smtp-accepted" });
      await pause();
    }
    return outcome;
  };
  let sweep = 0;
  const worker = assembleNotificationPipeline({
    config: config.notifications,
    prisma: app.get(PrismaClientProvider),
    transport: {
      ...notifications.transport,
      outbox: {
        relay: (lane, publish) =>
          notifications.transport.outbox.relay(
            lane,
            async (envelope, metadata) => {
              if (
                input.phase === "legacy-command" &&
                lane === "emailMaterial"
              ) {
                send({
                  kind: "legacy-command-held",
                  messageId: envelope.messageId,
                });
                await pause();
              }
              await publish(envelope, metadata);
              if (
                input.phase === "before-result-ack" &&
                lane === "emailResult" &&
                isSent(envelope.payload)
              ) {
                await telemetry.flush();
                send({
                  kind: "sent-result-confirmed",
                  messageId: envelope.messageId,
                });
                await pause();
              }
            },
          ),
      },
      async accept(envelope, metadata) {
        const result = await notifications.transport.accept(envelope, metadata);
        if (
          input.phase === "before-result-ack" &&
          envelope.lane === "emailResult" &&
          isSent(envelope.payload)
        ) {
          await telemetry.flush();
          send({
            kind: "sent-result-admitted",
            messageId: envelope.messageId,
            result,
          });
          await pause();
        }
        return result;
      },
    },
    processInbox: () =>
      telemetry.runJob(async () => {
        const observations = await notifications.sweep(sender);
        send({ kind: "sweep", sequence: ++sweep });
        return observations;
      }),
    runInboxSweep: (work) =>
      runWithLogContext(
        {
          process: "notifications-worker",
          queue: "notifications.inbox",
          requestId: generateRequestId(),
        },
        work,
      ),
    report: (event) =>
      writeLog(
        event["error"] === undefined ? "info" : "error",
        "notification_transport",
        {
          process: "notifications-worker",
          ...event,
        },
      ),
  });
  cleanup.unshift(() => worker.stop());
  await telemetry.runJob(() => worker.start());
  send({ kind: "ready" });
  await Promise.race([stop, worker.failed]);
} catch {
  send({ kind: "fixture-failed" });
  process.exitCode = 1;
} finally {
  await finishFixtureCleanup(cleanup);
  send({ kind: "stopped" });
}
