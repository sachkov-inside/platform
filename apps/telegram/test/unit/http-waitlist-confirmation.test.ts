import { ExportResultCode } from "@opentelemetry/core";
import type { ReadableSpan } from "@opentelemetry/sdk-trace-base";
import { createTelegramObservability } from "../../src/observability/telegram-sdk.js";
import { randomUUID } from "node:crypto";
import { expect, test, vi } from "vitest";
import { HttpWaitlistConfirmationAdapter } from "../../src/adapters/platform/http-waitlist-confirmation.adapter.js";
const command = {
  contractVersion: "inside.waitlist-confirmation.v1" as const,
  eventId: randomUUID(),
  intakeId: randomUUID(),
  accountRef: "synthetic-account",
  telegramIdentityRef: "synthetic-identity",
  linkRevision: 1,
};
test("receipt dispatch authorization binds the service response to its exact event and fails closed", async () => {
  const fetcher = vi.fn<typeof fetch>(() =>
    Promise.resolve(
      Response.json({ eventId: command.eventId, status: "accepted" }),
    ),
  );
  const adapter = new HttpWaitlistConfirmationAdapter(
    "https://platform.test/integrations/telegram/v1/communications/authorize",
    "synthetic-secret",
    fetcher,
  );
  expect(await adapter.current(command)).toBe("accepted");
  expect(fetcher.mock.calls[0]?.[0]).toEqual(
    new URL(
      "https://platform.test/integrations/telegram/v1/communications/waitlist",
    ),
  );
  expect(fetcher.mock.calls[0]?.[1]?.redirect).toBe("error");
  fetcher.mockResolvedValueOnce(
    Response.json({ eventId: randomUUID(), status: "accepted" }),
  );
  expect(await adapter.current(command)).toBe("unavailable");
  fetcher.mockResolvedValueOnce(
    Response.json({
      eventId: command.eventId,
      status: "accepted",
      members: [],
    }),
  );
  expect(await adapter.current(command)).toBe("unavailable");
  fetcher.mockResolvedValueOnce(
    Response.json({ status: "accepted" }, { status: 401 }),
  );
  expect(await adapter.current(command)).toBe("unavailable");
  fetcher.mockResolvedValueOnce(
    Response.json({ eventId: command.eventId, status: "suppressed" }),
  );
  expect(await adapter.current(command)).toBe("suppressed");
});

test("actual authorization exports one CLIENT child of the persisted receipt and sends only its canonical carrier", async () => {
  const spans: ReadableSpan[] = [];
  const telemetry = createTelegramObservability({
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
  const fetcher = vi.fn<typeof fetch>(() =>
    Promise.resolve(
      Response.json({ eventId: command.eventId, status: "accepted" }),
    ),
  );
  const adapter = new HttpWaitlistConfirmationAdapter(
    "https://platform.test/authorize/",
    "synthetic-secret",
    fetcher,
    telemetry,
  );
  try {
    expect(
      await adapter.current(
        command,
        "00-1234567890abcdef1234567890abcdef-1234567890abcdef-00",
      ),
    ).toBe("accepted");
  } finally {
    await telemetry.shutdown();
  }
  expect(spans).toHaveLength(1);
  const span = spans[0];
  if (span === undefined) throw new Error("Expected one authorization span");
  expect(span.name).toBe("platform waitlist.confirm");
  expect(span.kind).toBe(2);
  expect(span.parentSpanContext?.spanId).toBe("1234567890abcdef");
  expect(span.spanContext().traceId).toBe("1234567890abcdef1234567890abcdef");
  expect(span.attributes["http.response.status_code"]).toBe(200);
  expect(span.attributes["telegram.outcome"]).toBe("accepted");
  expect(fetcher.mock.calls[0]?.[1]?.headers).toEqual({
    authorization: "Bearer synthetic-secret",
    "content-type": "application/json",
    traceparent: `00-1234567890abcdef1234567890abcdef-${span.spanContext().spanId}-01`,
  });
});
