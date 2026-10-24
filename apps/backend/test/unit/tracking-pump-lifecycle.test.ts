import {
  AggregationTemporality,
  InMemoryMetricExporter,
} from "@opentelemetry/sdk-metrics";
import { InMemorySpanExporter } from "@opentelemetry/sdk-trace-base";
import { expect, onTestFinished, test, vi } from "vitest";
import { parsePlatformConfig } from "../../src/config/platform-config.js";
import { createTechnicalTelemetry } from "../../src/infrastructure/observability/technical-telemetry.js";
import { TrackingHitPump } from "../../src/modules/communications/communications.module.js";
import { TrackingVisits } from "../../src/modules/communications/facets/tracking-visits/tracking-visits.js";
import { HttpCommunicationsProvider } from "../../src/modules/communications/infrastructure/http-communications-provider.js";
import type { PlatformPrisma } from "../../src/infrastructure/prisma/index.js";
import { requestSchema } from "../../src/modules/communications/communications-schema.generated.js";
import { PublicContentTargets } from "../../src/modules/materials/index.js";

function barrier() {
  let resolve = () => {
    /* assigned synchronously by the Promise constructor */
  };
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

const firstId = "a7b904b6-d3a6-45f8-adc0-2f9838463411";
const secondId = "a7b904b6-d3a6-45f8-adc0-2f9838463412";

test.each(["claim", "write"] as const)(
  "shutdown drains a sibling after %s failure, including a claim admitted after the batch rejects",
  async (failure) => {
    // This host boundary double controls PostgreSQL settlement only; native persistence proof belongs to the API/PG suite.
    const heldClaim = barrier();
    const heldProvider = barrier();
    const writes: string[] = [];
    const calls: string[] = [];
    const error = new Error("Synthetic PostgreSQL failure");
    const failures: string[] = [];
    const report = vi
      .spyOn(console, "error")
      .mockImplementation((...values: unknown[]) => {
        failures.push(values.map(String).join(" "));
      });
    onTestFinished(() => {
      report.mockRestore();
    });
    const persistenceBoundary = {
      communicationTrackingHit: {
        findMany: () =>
          Promise.resolve(
            [firstId, secondId].map((eventId) => ({
              eventId,
              token: "synthetic-tracking-token-00000000000000",
              traffic: "unknown",
              occurredAt: new Date("2026-10-07T09:00:00Z"),
              traceparent: null,
            })),
          ),
        updateMany: async (input: {
          where: { eventId: string; claimId?: string };
          data: { deliveredAt?: Date };
        }) => {
          const claiming = input.where.claimId === undefined;
          if (
            input.where.eventId === firstId &&
            ((failure === "claim" && claiming) ||
              (failure === "write" && !claiming))
          )
            throw error;
          if (input.where.eventId === secondId && claiming)
            await heldClaim.promise;
          if (!claiming) writes.push(input.where.eventId);
          return { count: 1 };
        },
      },
    };
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Host boundary implements only the tracking delegates this production delivery path uses.
    const prisma = persistenceBoundary as unknown as PlatformPrisma;
    const config = parsePlatformConfig({
      NODE_ENV: "test",
      DATABASE_URL: "postgresql://unused:unused@localhost/unused",
      TELEGRAM_TRACKING_ORIGIN: "https://inside.test",
      TELEGRAM_COMMUNICATIONS_ENDPOINT:
        "https://provider.test/integrations/platform/v1/communications",
      TELEGRAM_COMMUNICATIONS_SECRET: "synthetic-secret",
      TELEGRAM_AUTHOR_AUTHORIZATION_SECRET: "synthetic-author-secret",
      TELEGRAM_COMMUNICATIONS_BOT_IDENTITY: "test_bot",
    });
    const provider = new HttpCommunicationsProvider(
      config.communications,
      async (_url, init) => {
        if (typeof init?.body !== "string")
          throw new Error("Expected serialized provider request");
        const body: unknown = JSON.parse(init.body);
        const command = requestSchema.parse(body);
        if (command.operation !== "tracking.recordHit")
          throw new Error("Unexpected host proof operation");
        calls.push(command.payload.eventId);
        if (command.payload.eventId === secondId) await heldProvider.promise;
        return Response.json({
          contractVersion: "inside-communications-v1",
          status: "ok",
          eventId: command.payload.eventId,
          outcome: "recorded",
        });
      },
    );
    const visits = new TrackingVisits(
      prisma,
      provider,
      config.communicationsTrackingOrigin,
      new PublicContentTargets(prisma),
    );
    const pump = new TrackingHitPump(visits, config);
    const spans = new InMemorySpanExporter();
    const shutdownExporter = spans.shutdown.bind(spans);
    const stopped = vi.spyOn(spans, "shutdown").mockImplementation(() => {
      expect(writes).toEqual([secondId]);
      expect(
        spans
          .getFinishedSpans()
          .filter((span) => span.name === "tracking deliver"),
      ).toHaveLength(failure === "claim" ? 1 : 2);
      return shutdownExporter();
    });
    const telemetry = createTechnicalTelemetry({
      enabled: true,
      service: "platform-api",
      environment: "test",
      release: "test",
      sampleRatio: 1,
      exporters: {
        spans,
        metrics: new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE),
      },
    });
    const lifecycle: { closing?: Promise<void> } = {};
    onTestFinished(async () => {
      heldClaim.resolve();
      heldProvider.resolve();
      const drained = (lifecycle.closing ?? pump.onApplicationShutdown()).then(
        () => telemetry.shutdown(),
        () => telemetry.shutdown(),
      );
      try {
        await vi.runAllTimersAsync();
        await drained;
      } finally {
        vi.useRealTimers();
      }
    });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    vi.setSystemTime(new Date("2026-10-07T09:00:00Z"));
    pump.observeDeliveries(telemetry);
    pump.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(
      failures.some((value) => value.includes('"operation":"deliverPending"')),
    ).toBe(true);
    lifecycle.closing = pump
      .onApplicationShutdown()
      .then(() => telemetry.shutdown());
    await vi.advanceTimersByTimeAsync(0);
    expect(stopped).not.toHaveBeenCalled();
    heldClaim.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toContain(secondId);
    expect(stopped).not.toHaveBeenCalled();
    heldProvider.resolve();
    await vi.runAllTimersAsync();
    await lifecycle.closing;
    expect(writes).toEqual([secondId]);
    expect(stopped).toHaveBeenCalledOnce();
  },
);

test.each(["empty", "lost claim"] as const)(
  "an actual pump %s tick creates no delivery root",
  async (mode) => {
    let polls = 0;
    let claims = 0;
    const persistenceBoundary = {
      communicationTrackingHit: {
        findMany: () => {
          polls++;
          return Promise.resolve(
            mode === "empty"
              ? []
              : [
                  {
                    eventId: firstId,
                    token: "synthetic-tracking-token-00000000000000",
                    traffic: "unknown",
                    occurredAt: new Date("2026-10-07T09:00:00Z"),
                    traceparent: null,
                  },
                ],
          );
        },
        updateMany: () => {
          claims++;
          return Promise.resolve({ count: 0 });
        },
      },
    };
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Host boundary implements only the tracking delegates this production delivery path uses.
    const prisma = persistenceBoundary as unknown as PlatformPrisma;
    const config = parsePlatformConfig({
      NODE_ENV: "test",
      DATABASE_URL: "postgresql://unused:unused@localhost/unused",
      TELEGRAM_TRACKING_ORIGIN: "https://inside.test",
      TELEGRAM_COMMUNICATIONS_ENDPOINT:
        "https://provider.test/integrations/platform/v1/communications",
      TELEGRAM_COMMUNICATIONS_SECRET: "synthetic-secret",
      TELEGRAM_AUTHOR_AUTHORIZATION_SECRET: "synthetic-author-secret",
      TELEGRAM_COMMUNICATIONS_BOT_IDENTITY: "test_bot",
    });
    const provider = new HttpCommunicationsProvider(config.communications, () =>
      Promise.reject(new Error("Unclaimed rows must not contact the provider")),
    );
    const visits = new TrackingVisits(
      prisma,
      provider,
      config.communicationsTrackingOrigin,
      new PublicContentTargets(prisma),
    );
    const pump = new TrackingHitPump(visits, config);
    const spans = new InMemorySpanExporter();
    const metrics = new InMemoryMetricExporter(
      AggregationTemporality.CUMULATIVE,
    );
    const telemetry = createTechnicalTelemetry({
      enabled: true,
      service: "platform-api",
      environment: "test",
      release: "test",
      sampleRatio: 1,
      exporters: { spans, metrics },
    });
    onTestFinished(async () => {
      const closing = pump
        .onApplicationShutdown()
        .then(() => telemetry.shutdown());
      try {
        await vi.runAllTimersAsync();
        await closing;
      } finally {
        vi.useRealTimers();
      }
    });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    vi.setSystemTime(new Date("2026-10-07T09:00:00Z"));
    pump.observeDeliveries(telemetry);
    pump.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(polls).toBe(1);
    expect(claims).toBe(mode === "empty" ? 0 : 1);
    await pump.onApplicationShutdown();
    const flushed = telemetry.flush();
    await vi.runAllTimersAsync();
    await flushed;
    expect(spans.getFinishedSpans()).toEqual([]);
    expect(
      metrics
        .getMetrics()
        .flatMap((batch) =>
          batch.scopeMetrics.flatMap((scope) => scope.metrics),
        )
        .filter((metric) =>
          metric.descriptor.name.startsWith("inside.tracking."),
        )
        .flatMap((metric) =>
          metric.dataPoints.map((point) => point.attributes),
        ),
    ).toEqual([]);
  },
);
