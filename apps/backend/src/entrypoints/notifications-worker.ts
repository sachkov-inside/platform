import { technicalTelemetryFromEnvironment } from "../infrastructure/observability/technical-telemetry-runtime.js";
import {
  RUNTIME_IDENTITY,
  type RuntimeIdentity,
} from "../infrastructure/runtime-identity.js";
import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import {
  PLATFORM_CONFIG,
  type PlatformConfig,
} from "../config/platform-config.js";
import {
  StructuredNestLogger,
  generateRequestId,
  reportProcessFailure,
  runWithLogContext,
  writeLog,
} from "../infrastructure/observability/index.js";
import { OperationalReadiness } from "../infrastructure/operational-readiness.js";
import { PrismaClientProvider } from "../infrastructure/prisma/index.js";
import { runWorker } from "../infrastructure/worker-runtime.js";
import { assembleNotificationPipeline } from "./notifications-worker/assemble-notification-pipeline.js";
import {
  Notifications,
  assembleNotificationEmailSender,
} from "../modules/notifications/index.js";
import { NotificationsWorkerModule } from "./notifications-worker/notifications-worker.module.js";

void bootstrap().catch((error: unknown) =>
  reportProcessFailure("notifications-worker", error),
);
async function bootstrap() {
  const application = await NestFactory.createApplicationContext(
    NotificationsWorkerModule,
    { logger: new StructuredNestLogger() },
  );
  const config = application.get<PlatformConfig>(PLATFORM_CONFIG);
  if (!config.notifications) {
    await application.close();
    throw new Error("Notifications configuration required");
  }
  const prisma = application.get(PrismaClientProvider);
  const notifications = application.get(Notifications);
  const sendEmail =
    config.billingContact && config.notificationDelivery
      ? assembleNotificationEmailSender(config.billingContact)
      : undefined;
  const technicalTelemetry = technicalTelemetryFromEnvironment({
    environment: process.env,
    service: "platform-notifications-worker",
    mode: config.mode,
    identity: application.get<RuntimeIdentity>(RUNTIME_IDENTITY),
  });
  try {
    const worker = assembleNotificationPipeline({
      config: config.notifications,
      prisma,
      transport: notifications.transport,
      processInbox: () =>
        technicalTelemetry.runJob(() => notifications.sweep(sendEmail)),
      // Каждый проход разбора входящих вместе с его наблюдениями — своя единица работы в журнале.
      runInboxSweep: (sweep) =>
        runWithLogContext(
          {
            process: "notifications-worker",
            queue: "notifications.inbox",
            requestId: generateRequestId(),
          },
          sweep,
        ),
      report: (event) =>
        writeLog(transportLogLevel(event), "notification_transport", {
          process: "notifications-worker",
          ...event,
        }),
    });
    await runWorker({
      application,
      databaseUrl: config.database.url,
      jobs: {
        start: () => technicalTelemetry.runJob(() => worker.start()),
        stop: (options) => worker.stop(options),
      },
      failed: worker.failed,
      process: "notifications-worker",
      readiness: application.get(OperationalReadiness),
      registerJobs: () => Promise.resolve(),
    });
  } finally {
    await technicalTelemetry.shutdown();
  }
}

// Наблюдение с причиной — сбой, остальные сигналы оператору — предупреждение.
function transportLogLevel(
  event: Readonly<Record<string, unknown>>,
): "info" | "warn" | "error" {
  if (event["error"] !== undefined) return "error";
  return event["status"] === "operator_attention" ? "warn" : "info";
}
