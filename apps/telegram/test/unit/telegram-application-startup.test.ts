// deterministic-test-allow unit-io: owned native collector proves factory SDK cleanup order; existing1000ms exporter budget and finally closes receiver.
import { createServer, type ServerResponse } from "node:http";
import { once } from "node:events";
import { NestFactory } from "@nestjs/core";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Kysely } from "kysely";
import { Pool } from "pg";
import { BackgroundWorkers } from "../../src/operations/background-workers.js";
import { NotificationWorker } from "../../src/operations/notification-worker.js";
import { afterEach, expect, it, vi } from "vitest";
import { createTelegramApplication } from "../../src/application/create-telegram-application.js";
import { loadApplicationConfig } from "../../src/config/application-config.js";
import { deferred } from "../support/deferred.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

it("exposes cached close before failed Nest acquisition and destroys its real lazy database exactly once", async () => {
  const config = configuration();
  // Nest is an external acquisition boundary; PG's real lazy pool never connects in this contract.
  const acquisition = deferred<NestFastifyApplication>();
  const original = new Error("synthetic Nest acquisition");
  const create = vi
    .spyOn(NestFactory, "create")
    .mockReturnValue(acquisition.promise);
  const destroy = vi.spyOn(Kysely.prototype, "destroy");
  const end = vi.spyOn(Pool.prototype, "end");
  const handle = createTelegramApplication(config);
  const observedStartup = handle.application.catch((error: unknown) => error);
  const closing = handle.close();
  const observedClose = closing.catch((error: unknown) => error);
  try {
    expect(handle.close()).toBe(closing);
    expect(create).toHaveBeenCalledOnce();
    expect(create.mock.calls[0]?.[2]).toMatchObject({ abortOnError: false });
    expect(destroy).not.toHaveBeenCalled();
    acquisition.reject(original);
    expect(await observedStartup).toBe(original);
    expect(await observedClose).toBe(original);
    expect(destroy).toHaveBeenCalledOnce();
    // Kysely has never initialized its driver, so no PG connection or Pool.end was needed.
    expect(end).not.toHaveBeenCalled();
  } finally {
    acquisition.reject(original);
    await observedStartup;
    await observedClose;
  }
});

function configuration() {
  return loadApplicationConfig({
    DATABASE_URL: "postgresql://synthetic:synthetic@127.0.0.1:1/synthetic",
    TELEGRAM_BOT_IDENTITY: "synthetic",
    TELEGRAM_WEBHOOK_SECRET: "synthetic_webhook_secret_00000000",
    PLATFORM_INTEGRATION_SECRET: "synthetic_platform_secret_0000000",
    WORKERS_ENABLED: "false",
    TELEGRAM_CANONICAL_CHAT_ID: "-1000000000000",
    TELEGRAM_LINK_RECEIPT_TEXT: "Synthetic receipt",
    TELEGRAM_LINKED_MEMBER_TEXT: "Synthetic member",
    TELEGRAM_LINKED_NON_MEMBER_TEXT: "Synthetic nonmember",
    TELEGRAM_LINKED_UNAVAILABLE_TEXT: "Synthetic unavailable",
    TELEGRAM_WELCOME_TEXT: "Synthetic welcome",
  });
}

it("closes newly acquired real Nest owners before init/listen when startup was already stopped", async () => {
  const acquired = deferred<NestFastifyApplication>();
  const release = deferred();
  const create = NestFactory.create.bind(NestFactory);
  vi.spyOn(NestFactory, "create").mockImplementation(
    async (module, adapter, options) => {
      const application = await create<NestFastifyApplication>(
        module,
        adapter,
        options,
      );
      acquired.resolve(application);
      await release.promise;
      return application;
    },
  );
  const destroy = vi.spyOn(Kysely.prototype, "destroy");
  const connect = vi.spyOn(Pool.prototype, "connect");
  const handle = createTelegramApplication(configuration());
  const observed = handle.application.catch((error: unknown) => error);
  const app = await acquired.promise;
  const init = vi.spyOn(app, "init");
  const listen = vi.spyOn(app, "listen");
  const dispose = vi.spyOn(app, "close");
  const closing = handle.close();
  try {
    expect(destroy).not.toHaveBeenCalled();
    release.resolve();
    expect(await observed).toBeUndefined();
    await closing;
    expect(init).not.toHaveBeenCalled();
    expect(listen).not.toHaveBeenCalled();
    expect(connect).not.toHaveBeenCalled();
    expect(destroy).toHaveBeenCalledOnce();
    expect(dispose).toHaveBeenCalledOnce();
    expect(app.get(BackgroundWorkers).isQuiescent()).toBe(true);
    expect(app.get(NotificationWorker).isQuiescent()).toBe(true);
    expect(handle.close()).toBe(closing);
  } finally {
    release.resolve();
    await observed;
    await closing;
  }
});

it("failed managed Nest acquisition flushes its actual SDK before destroying the database", async () => {
  const metricsSeen = deferred();
  const acquisition = deferred<NestFastifyApplication>();
  const original = new Error("synthetic failed managed acquisition");
  let pending: ServerResponse | undefined;
  const receiver = createServer((request, response) => {
    request.resume();
    request.once("end", () => {
      pending = response;
      response.writeHead(200, { "content-type": "application/json" });
      metricsSeen.resolve();
    });
  });
  let handle: ReturnType<typeof createTelegramApplication> | undefined;
  let observed: Promise<unknown> | undefined;
  vi.spyOn(NestFactory, "create").mockReturnValue(acquisition.promise);
  const destroy = vi.spyOn(Kysely.prototype, "destroy");
  try {
    receiver.listen(0, "127.0.0.1");
    await once(receiver, "listening");
    const address = receiver.address();
    if (address === null || typeof address === "string")
      throw new Error("Owned collector address unavailable");
    for (const key of Object.keys(process.env))
      if (key.startsWith("OTEL_EXPORTER_OTLP")) vi.stubEnv(key, undefined);
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("INSIDE_OTEL_ENABLED", "true");
    vi.stubEnv("INSIDE_OTEL_ENDPOINT", `http://127.0.0.1:${address.port}`);
    handle = createTelegramApplication(configuration());
    observed = handle.application.catch((error: unknown) => error);
    acquisition.reject(original);
    const first = await Promise.race([
      metricsSeen.promise.then(() => "telemetry"),
      observed.then(() => "startup"),
    ]);
    expect(first).toBe("telemetry");
    expect(destroy).not.toHaveBeenCalled();
    pending?.end("{}");
    expect(await observed).toBe(original);
    expect(destroy).toHaveBeenCalledOnce();
    const closing = handle.close();
    expect(handle.close()).toBe(closing);
    await expect(closing).rejects.toBe(original);
  } finally {
    acquisition.reject(original);
    pending?.end("{}");
    await observed;
    await handle?.close().catch(() => undefined);
    await new Promise<void>((resolve, reject) =>
      receiver.close((error) =>
        error === undefined ? resolve() : reject(error),
      ),
    );
  }
});
