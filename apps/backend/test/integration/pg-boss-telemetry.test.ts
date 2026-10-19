import { fork, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { InMemorySpanExporter } from "@opentelemetry/sdk-trace-base";
import {
  AggregationTemporality,
  InMemoryMetricExporter,
} from "@opentelemetry/sdk-metrics";
import { createTechnicalTelemetry } from "../../src/infrastructure/observability/technical-telemetry.js";
import { PgBoss } from "pg-boss";
import { describe, expect, test } from "vitest";
import { z } from "zod";
import { Prisma } from "../../src/infrastructure/prisma/index.js";
import { createTestDatabase } from "./setup/test-database.js";

const attemptSchema = z.object({
  kind: z.literal("attempt"),
  jobId: z.string(),
  traceId: z.string(),
  spanId: z.string(),
  retryCount: z.number(),
  release: z.string(),
});

describe("durable queue technical context", () => {
  test("links a real batch to both producer spans without inheriting worker-registration context", async () => {
    const database = await createTestDatabase();
    const spans = new InMemorySpanExporter();
    const metrics = new InMemoryMetricExporter(
      AggregationTemporality.CUMULATIVE,
    );
    const telemetry = createTechnicalTelemetry({
      enabled: true,
      service: "platform-material-assets-worker",
      environment: "test",
      release: "batch-proof",
      sampleRatio: 1,
      exporters: { spans, metrics },
    });
    const boss = new PgBoss({
      connectionString: database.url,
      openTelemetry: telemetry.pgBoss(["material-assets.cleanup"]),
    });
    try {
      await boss.start();
      await boss.createQueue("material-assets.cleanup");
      for (let index = 0; index < 2; index++) {
        const request = telemetry.startHttp({
          method: "POST",
          route: "/batch-proof",
        });
        await request.run(() =>
          boss.send("material-assets.cleanup", { index }),
        );
        request.finish(200, 1);
      }
      let observed: ((size: number) => void) | undefined;
      const handled = new Promise<number>((resolve) => {
        observed = resolve;
      });
      await boss.work(
        "material-assets.cleanup",
        { batchSize: 2, pollingIntervalSeconds: 0.5 },
        (jobs) => {
          observed?.(jobs.length);
          return Promise.resolve();
        },
      );
      expect(await handled).toBe(2);
      await boss.stop({ close: true, graceful: true });
      await telemetry.flush();
      const finished = spans.getFinishedSpans();
      const producers = finished.filter(
        (span) => span.name === "send material-assets.cleanup",
      );
      const consumer = finished.find(
        (span) => span.name === "process material-assets.cleanup",
      );
      expect(producers).toHaveLength(2);
      expect(consumer?.parentSpanContext).toBeUndefined();
      expect(consumer?.links.map((link) => link.context.spanId).sort()).toEqual(
        producers.map((span) => span.spanContext().spanId).sort(),
      );
      expect(
        producers.every(
          (span) =>
            span.spanContext().traceId !== consumer?.spanContext().traceId,
        ),
      ).toBe(true);
    } finally {
      await Promise.allSettled([
        boss.stop({ close: true, graceful: false }),
        telemetry.shutdown(),
      ]);
      await database.dispose();
    }
  });
  test("continues a persisted producer trace after SIGKILL and retry across processes without exporting private input", async () => {
    const database = await createTestDatabase();
    const captured: string[] = [];
    const receiver = createServer((request, response) => {
      let body = "";
      request.setEncoding("utf8");
      request.on("data", (chunk: string) => {
        body += chunk;
      });
      request.on("end", () => {
        captured.push(body);
        response.writeHead(200, { "content-type": "application/json" });
        response.end("{}");
      });
    });
    const children: {
      child: ChildProcess;
      exited: Promise<unknown>;
      messages: unknown[];
      output: string[];
    }[] = [];
    const inspector = new PgBoss({
      connectionString: database.url,
      openTelemetry: { enabled: false },
    });
    try {
      receiver.listen(0, "127.0.0.1");
      await once(receiver, "listening");
      const address = receiver.address();
      if (address === null || typeof address === "string")
        throw new Error("listener address unavailable");
      const launch = (mode: "produce" | "crash" | "retry") => {
        // deterministic-test-allow process-cleanup: each child is registered immediately, killed in finally if live, and its pre-registered exit promise is awaited before database disposal.
        const child = fork(
          new URL("./fixtures/pg-boss-telemetry-worker.ts", import.meta.url),
          [],
          {
            execArgv: ["--import", "tsx"],
            stdio: ["ignore", "pipe", "pipe", "ipc"],
            env: {
              ...Object.fromEntries(
                Object.entries(process.env).filter(
                  ([key]) => !key.startsWith("OTEL_EXPORTER_OTLP"),
                ),
              ),
              PG_BOSS_TELEMETRY_FIXTURE: JSON.stringify({
                databaseUrl: database.url,
                endpoint: `http://127.0.0.1:${address.port}`,
                mode,
              }),
            },
          },
        );
        const owned = {
          child,
          exited: once(child, "exit"),
          messages: [] as unknown[],
          output: [] as string[],
        };
        child.on("message", (message: unknown) => owned.messages.push(message));
        child.stdout?.setEncoding("utf8");
        child.stdout?.on("data", (chunk: string) => owned.output.push(chunk));
        child.stderr?.resume();
        children.push(owned);
        return owned;
      };
      const producer = launch("produce");
      expect(await producer.exited).toEqual([0, null]);
      const produced = z
        .object({ kind: z.literal("produced"), jobId: z.string() })
        .parse(producer.messages[0]);
      await inspector.start();
      const pending = await inspector.findJobs("material-assets.cleanup", {
        id: produced.jobId,
      });
      expect(pending[0]?.data).toEqual({ private: "sentinel-payload" });
      // The public pg-boss job deliberately hides its library-owned propagation column.
      const carriers = z
        .array(
          z.object({
            trace_context: z
              .object({
                traceparent: z
                  .string()
                  .regex(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/u),
              })
              .strict(),
          }),
        )
        .parse(
          await database.prisma.$queryRaw(
            Prisma.sql`select trace_context from pgboss.job where id = ${produced.jobId}::uuid`,
          ),
        );
      expect(carriers).toHaveLength(1);
      const crashed = launch("crash");
      await once(crashed.child, "message");
      const first = attemptSchema.parse(crashed.messages[0]);
      crashed.child.kill("SIGKILL");
      expect(await crashed.exited).toEqual([null, "SIGKILL"]);
      const restarted = launch("retry");
      expect(await restarted.exited).toEqual([0, null]);
      const attempts = [
        first,
        ...restarted.messages.map((message) => attemptSchema.parse(message)),
      ];
      expect(attempts.map((attempt) => attempt.retryCount)).toEqual([0, 1, 2]);
      expect(new Set(attempts.map((attempt) => attempt.traceId)).size).toBe(1);
      expect(new Set(attempts.map((attempt) => attempt.spanId)).size).toBe(3);
      expect(
        attempts.every(
          (attempt) =>
            attempt.jobId === produced.jobId &&
            attempt.release === "queue-proof",
        ),
      ).toBe(true);
      const wire = captured.join("\n");
      expect(wire).toContain(first.traceId);
      const traceEnvelope = z.object({
        resourceSpans: z.array(
          z.object({
            scopeSpans: z.array(
              z.object({
                spans: z.array(
                  z.object({
                    name: z.string(),
                    traceId: z.string(),
                    spanId: z.string(),
                    parentSpanId: z.string().optional(),
                  }),
                ),
              }),
            ),
          }),
        ),
      });
      const exported = captured.flatMap((body) => {
        const parsed = traceEnvelope.safeParse(JSON.parse(body));
        return parsed.success
          ? parsed.data.resourceSpans.flatMap((resource) =>
              resource.scopeSpans.flatMap((scope) => scope.spans),
            )
          : [];
      });
      const sent = exported.find(
        (span) => span.name === "send material-assets.cleanup",
      );
      expect(sent?.traceId).toBe(first.traceId);
      const processed = exported.filter(
        (span) => span.name === "process material-assets.cleanup",
      );
      // SIGKILL cannot end/export the interrupted attempt; the durable retries retain its producer parent.
      expect(processed).toHaveLength(2);
      expect(
        processed.every(
          (span) =>
            span.parentSpanId === sent?.spanId &&
            span.traceId === first.traceId,
        ),
      ).toBe(true);
      const records = [...crashed.output, ...restarted.output]
        .join("")
        .trim()
        .split("\n")
        .map((line) =>
          z.record(z.string(), z.unknown()).parse(JSON.parse(line)),
        );
      expect(records).toHaveLength(3);
      expect(
        records.every(
          (record) =>
            record["requestId"] === produced.jobId &&
            record["release"] === "queue-proof" &&
            record["traceId"] === first.traceId,
        ),
      ).toBe(true);
      expect(wire).toContain("messaging.process.duration");
      expect(wire).toContain("job_error");
      expect(wire).not.toContain("sentinel-");
      expect(
        (
          await inspector.findJobs("material-assets.cleanup", {
            id: produced.jobId,
          })
        )[0]?.state,
      ).toBe("completed");
    } finally {
      for (const owned of children) {
        if (owned.child.exitCode === null && owned.child.signalCode === null)
          owned.child.kill("SIGKILL");
      }
      await Promise.allSettled(children.map((owned) => owned.exited));
      await Promise.allSettled([
        inspector.stop({ close: true, graceful: false }),
        new Promise<void>((resolve, reject) =>
          receiver.close((error) =>
            error === undefined ? resolve() : reject(error),
          ),
        ),
      ]);
      await database.dispose();
    }
  });
});
