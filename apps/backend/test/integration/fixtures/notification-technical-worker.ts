import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { z } from "zod";
import { NotificationsWorkerModule } from "../../../src/entrypoints/notifications-worker/notifications-worker.module.js";
import { technicalTelemetryFromEnvironment } from "../../../src/infrastructure/observability/technical-telemetry-runtime.js";
import {
  connectNotificationBroker,
  consumeNotificationLane,
  publishNotification,
} from "../../../src/infrastructure/notification-transport/rabbitmq.js";
import { assembleMaterialsNotificationOutbox } from "../../../src/modules/materials/index.js";
import { Notifications } from "../../../src/modules/notifications/index.js";
import { PrismaClientProvider } from "../../../src/infrastructure/prisma/index.js";
import { eventually } from "../setup/eventually.js";
import { boundedProcessFact } from "../setup/queue-telemetry-process.js";

const input = z
  .object({
    endpoint: z.string(),
    action: z.enum([
      "fail-publish",
      "confirm-crash",
      "publish",
      "accept-crash",
      "accept",
      "audience",
    ]),
    urls: z.object({ materials: z.string(), notifications: z.string() }),
  })
  .parse(JSON.parse(process.env["PG_BOSS_TELEMETRY_FIXTURE"] ?? "null"));
const PROCESS_FACT_BUDGET_MS = 25_000;
const send = (record: Readonly<Record<string, unknown>>) =>
  process.stdout.write(`${JSON.stringify({ pid: process.pid, ...record })}\n`);
const app = await NestFactory.createApplicationContext(
  NotificationsWorkerModule,
  { logger: false },
);
const telemetry = technicalTelemetryFromEnvironment({
  environment: {
    INSIDE_OTEL_ENABLED: "true",
    INSIDE_OTEL_ENDPOINT: input.endpoint,
  },
  service: "platform-notifications-worker",
  mode: "test",
  identity: {
    release: "notification-recovery-proof",
    sourceSha: "0000000000000000000000000000000000000000",
  },
});
const prisma = app.get(PrismaClientProvider);
const notifications = app.get(Notifications);
let connection:
  Awaited<ReturnType<typeof connectNotificationBroker>> | undefined;
let consumer: Awaited<ReturnType<typeof consumeNotificationLane>> | undefined;
try {
  if (input.action === "audience") {
    await telemetry.runJob(() => notifications.sweep());
    await telemetry.flush();
    send({ kind: "audience" });
  } else if (input.action === "accept" || input.action === "accept-crash") {
    const subscriber = await connectNotificationBroker({
      url: input.urls.notifications,
    });
    connection = subscriber;
    let received: (() => void) | undefined;
    const completed = new Promise<void>((resolve) => {
      received = resolve;
    });
    consumer = await telemetry.runJob(() =>
      consumeNotificationLane(
        subscriber,
        "materials",
        {
          ...notifications.transport,
          async accept(envelope, metadata) {
            const result = await notifications.transport.accept(
              envelope,
              metadata,
            );
            if (input.action === "accept-crash") {
              send({ kind: "accepted", result });
              await new Promise<void>(() => undefined);
            }
            received?.();
            return result;
          },
        },
        1,
      ),
    );
    send({ kind: "ready" });
    await boundedProcessFact(completed, PROCESS_FACT_BUDGET_MS);
    await consumer.stop();
    await telemetry.flush();
    send({ kind: "acknowledged" });
  } else {
    const publisher = await connectNotificationBroker({
      url: input.urls.materials,
    });
    connection = publisher;
    if (input.action === "fail-publish") await publisher.close();
    try {
      await eventually(
        async () => {
          const relayed = await telemetry.runJob(() =>
            assembleMaterialsNotificationOutbox(prisma).relay(
              "materials",
              async (envelope, metadata) => {
                await publishNotification(publisher, envelope, metadata);
                if (input.action === "confirm-crash") {
                  send({ kind: "confirmed" });
                  await new Promise<void>(() => undefined);
                }
              },
            ),
          );
          if (!relayed) throw new Error("relay pending");
        },
        input.action === "fail-publish" ? 0 : PROCESS_FACT_BUDGET_MS,
      );
      send({ kind: "published" });
    } catch (error) {
      if (input.action !== "fail-publish") throw error;
      send({ kind: "publish-failed" });
    }
  }
} catch {
  send({ kind: "fixture-failed" });
  process.exitCode = 1;
} finally {
  await consumer?.stop();
  await connection?.close().catch(() => undefined);
  await app.close();
  await telemetry.shutdown();
}
