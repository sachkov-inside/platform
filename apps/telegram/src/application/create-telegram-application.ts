import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { AppModule } from "../app.module.js";
import type { ApplicationConfig } from "../config/application-config.js";
import { createDatabase } from "../database/create-database.js";
import { SubscriptionActivation } from "../modules/subscription-activation/subscription-activation.js";
import { BackgroundWorkers } from "../operations/background-workers.js";
import { NotificationWorker } from "../operations/notification-worker.js";
import { disabledTelegramObservability } from "../observability/telegram-observability.js";
import type { DrainReport } from "../shared/drain-report.js";
import {
  ApplicationClose,
  type ProducerLifetime,
} from "./application-close.js";
import { HttpLifetime } from "./http-lifetime.js";

export interface TelegramApplicationHandle {
  readonly application: Promise<NestFastifyApplication | undefined>;
  close(): Promise<void>;
}

/** Synchronous handle exposes the sole close owner before any awaited startup acquisition. */
export function createTelegramApplication(
  config: ApplicationConfig,
): TelegramApplicationHandle {
  const database = createDatabase(config.databaseUrl);
  const telemetry = disabledTelegramObservability;
  const startupFailures: unknown[] = [];
  let adapter: FastifyAdapter | undefined;
  let http: HttpLifetime | undefined;
  let application: NestFastifyApplication | undefined;
  let background: BackgroundWorkers | undefined;
  let notifications: NotificationWorker | undefined;
  let activation: SubscriptionActivation | undefined;
  let closing = false;
  let startupSettled = false;
  const isClosing = (): boolean => closing;
  let settleAcquisition!: () => void;
  const acquired = new Promise<void>((resolve) => {
    settleAcquisition = resolve;
  });
  const stopped = new WeakSet<object>();
  const quiet: DrainReport = { quiescent: true, failures: [] };
  const begin = (owner: { beginStop(): void } | undefined): void => {
    if (owner === undefined || stopped.has(owner)) return;
    stopped.add(owner);
    owner.beginStop();
  };
  const httpPort: ProducerLifetime = {
    beginStop: () => {
      closing = true;
      http?.closeAdmission();
      if (startupSettled) begin(http);
    },
    drain: () => http?.drain() ?? Promise.resolve(quiet),
    whenQuiescent: async () => {
      await http?.whenQuiescent();
    },
    isQuiescent: () => http?.isQuiescent() ?? true,
  };
  const backgroundPort: ProducerLifetime = {
    beginStop: () => begin(background),
    drain: () => background?.drain() ?? Promise.resolve(quiet),
    whenQuiescent: async () => {
      await background?.whenQuiescent();
    },
    isQuiescent: () => background?.isQuiescent() ?? true,
  };
  const notificationPort: ProducerLifetime = {
    beginStop: () => begin(notifications),
    drain: () => notifications?.drain() ?? Promise.resolve(quiet),
    whenQuiescent: async () => {
      await notifications?.whenQuiescent();
    },
    isQuiescent: () => notifications?.isQuiescent() ?? true,
  };
  // This executor and its PG cleanup are registered before starting Nest acquisition.
  const lifetime = new ApplicationClose({
    acquired,
    startupFailures,
    http: httpPort,
    background: backgroundPort,
    notifications: notificationPort,
    actions: {
      drain: () => activation?.drainActions() ?? Promise.resolve(quiet),
      whenQuiescent: async () => {
        await activation?.whenActionsQuiescent();
      },
    },
    telemetry: () => telemetry.shutdown(),
    database: () => database.destroy(),
    framework: async () => {
      await application?.close();
    },
  });
  const startup = (async () => {
    try {
      adapter = new FastifyAdapter({ bodyLimit: 1024 * 1024 });
      http = new HttpLifetime(adapter.getInstance());
      if (isClosing()) http.closeAdmission();
      application = await NestFactory.create<NestFastifyApplication>(
        AppModule.registerManaged(config, database),
        adapter,
        { abortOnError: false, logger: ["error", "warn", "log"] },
      );
      background = application.get(BackgroundWorkers);
      if (isClosing()) begin(background);
      notifications = application.get(NotificationWorker);
      if (isClosing()) begin(notifications);
      activation = application.get(SubscriptionActivation);
      if (isClosing()) return undefined;
      await application.init();
      if (isClosing()) return undefined;
      await application.listen(config.port, config.host);
      if (isClosing()) return undefined;
      return application;
    } catch (error: unknown) {
      startupFailures.push(error);
      return undefined;
    } finally {
      // Independent of the public startup Promise, which may itself await close on failure.
      startupSettled = true;
      settleAcquisition();
    }
  })();
  const ready = startup.then(async (result) => {
    if (result === undefined || isClosing()) {
      await lifetime.close();
      return undefined;
    }
    return result;
  });
  return { application: ready, close: () => lifetime.close() };
}
