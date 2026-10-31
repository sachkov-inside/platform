// deterministic-test-allow unit-io: pinned Grammy native HTTP to an owned loopback receiver; finally closes SDK and all receiver connections.
import { createServer } from "node:http";
import { once } from "node:events";
import { Api } from "grammy";
import { ExportResultCode } from "@opentelemetry/core";
import type { ReadableSpan } from "@opentelemetry/sdk-trace-base";
import { expect, test } from "vitest";
import { GrammyCommunicationsAdapter } from "../../src/adapters/telegram/grammy-communications.adapter.js";
import { createTelegramObservability } from "../../src/observability/telegram-sdk.js";

// This exercises the actual pinned client transport and adapter, not durable queue/PG ownership.
test.each(["delivered", "retryable"] as const)(
  "cold Grammy wire preserves %s result without propagating technical headers to Bot API",
  async (mode) => {
    const spans: ReadableSpan[] = [];
    const runtime = createTelegramObservability({
      identity: {
        release: "test",
        sourceSha: "0000000000000000000000000000000000000000",
      },
      mode: "test",
      sampleRatio: 1,
      exporters: {
        spans: {
          export: (batch, callback) => {
            spans.push(...batch);
            callback({ code: ExportResultCode.SUCCESS });
          },
          shutdown: () => Promise.resolve(),
        },
        metrics: {
          export: (_batch, callback) =>
            callback({ code: ExportResultCode.SUCCESS }),
          forceFlush: () => Promise.resolve(),
          shutdown: () => Promise.resolve(),
        },
      },
    });
    const calls: {
      method: string | undefined;
      path: string | undefined;
      technicalHeaders: boolean;
      body: string;
    }[] = [];
    const receiver = createServer((req, res) => {
      let body = "";
      req.setEncoding("utf8");
      req.on("data", (chunk: string) => {
        body += chunk;
      });
      req.on("end", () => {
        calls.push({
          method: req.method,
          path: req.url,
          technicalHeaders: ["traceparent", "baggage", "tracestate"].some(
            (name) => req.headers[name] !== undefined,
          ),
          body,
        });
        res.writeHead(mode === "retryable" ? 429 : 200, {
          "content-type": "application/json",
        });
        res.end(
          JSON.stringify(
            mode === "retryable"
              ? {
                  ok: false,
                  error_code: 429,
                  description: "synthetic slow down",
                  parameters: { retry_after: 3 },
                }
              : { ok: true, result: { message_id: 73 } },
          ),
        );
      });
    });
    try {
      receiver.listen(0, "127.0.0.1");
      await once(receiver, "listening");
      const address = receiver.address();
      if (address === null || typeof address === "string")
        throw new Error("Owned Bot API address unavailable");
      const api = new Api("123456:synthetic_private_token", {
        apiRoot: `http://127.0.0.1:${address.port}`,
      });
      const adapter = new GrammyCommunicationsAdapter(api);
      const result = await runtime.runAttempt(
        "00-1234567890abcdef1234567890abcdef-1234567890abcdef-01",
        () =>
          runtime.runBotApi(() =>
            adapter.send({
              chatId: "424242",
              content: {
                type: "text",
                text: "synthetic_private_confirmation",
                entities: [],
                buttons: [],
              },
            }),
          ),
      );
      expect(result).toEqual(
        mode === "retryable"
          ? {
              kind: "api_retryable",
              providerErrorCode: 429,
              retryAfterSeconds: 3,
            }
          : { kind: "delivered", providerMessageId: "73" },
      );
      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({
        method: "POST",
        path: "/bot123456:synthetic_private_token/sendMessage",
        technicalHeaders: false,
      });
      expect(JSON.parse(calls[0]?.body ?? "null")).toEqual({
        chat_id: "424242",
        text: "synthetic_private_confirmation",
        entities: [],
        reply_markup: { inline_keyboard: [] },
      });
      await runtime.shutdown();
      const send = spans.find((span) => span.name === "telegram sendMessage");
      const attempt = spans.find((span) => span.name === "waitlist attempt");
      expect(spans).toHaveLength(2);
      expect(send?.parentSpanContext?.spanId).toBe(
        attempt?.spanContext().spanId,
      );
      expect(send?.attributes["telegram.outcome"]).toBe(
        mode === "retryable" ? "api_retryable" : "delivered",
      );
      const metadata = JSON.stringify(
        spans.map((span) => ({
          name: span.name,
          attributes: span.attributes,
          events: span.events,
          links: span.links,
        })),
      );
      expect(metadata).not.toContain("synthetic_private");
      expect(metadata).not.toContain("424242");
      expect(metadata).not.toContain("73");
    } finally {
      try {
        await runtime.shutdown();
      } finally {
        receiver.closeAllConnections();
        if (receiver.listening)
          await new Promise<void>((resolve, reject) =>
            receiver.close((error) => (error ? reject(error) : resolve())),
          );
      }
    }
  },
);
