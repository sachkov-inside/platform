// deterministic-test-allow unit-io: real pinned OTLP JSON exporter to an owned loopback receiver; finally closes SDK and receiver.
import { createServer } from "node:http";
import { once } from "node:events";
import { afterEach, expect, it, vi } from "vitest";
import { telegramObservabilityFromEnvironment } from "../../src/observability/telegram-telemetry-runtime.js";

afterEach(() => vi.unstubAllEnvs());

it("actual pinned OTLP HTTP transport exports Telegram spans and independent metrics without private work data", async () => {
  for (const key of Object.keys(process.env))
    if (key.startsWith("OTEL_EXPORTER_OTLP")) vi.stubEnv(key, undefined);
  const captured: {
    path: string;
    contentType: string | undefined;
    body: string;
    authenticated: boolean;
  }[] = [];
  const receiver = createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => {
      body += chunk;
      if (body.length > 65536) {
        response.writeHead(413);
        response.end();
        request.destroy();
      }
    });
    request.on("end", () => {
      captured.push({
        path: request.url ?? "",
        contentType: request.headers["content-type"],
        body,
        authenticated: request.headers.authorization !== undefined,
      });
      response.writeHead(200, { "content-type": "application/json" });
      response.end("{}");
    });
  });
  let runtime:
    ReturnType<typeof telegramObservabilityFromEnvironment> | undefined;
  try {
    receiver.listen(0, "127.0.0.1");
    await once(receiver, "listening");
    const address = receiver.address();
    if (address === null || typeof address === "string")
      throw new Error("Owned collector address unavailable");
    runtime = telegramObservabilityFromEnvironment({
      mode: "test",
      environment: {
        INSIDE_OTEL_ENABLED: "true",
        INSIDE_OTEL_ENDPOINT: `http://127.0.0.1:${address.port}`,
        INSIDE_OTEL_SAMPLE_RATIO: "1",
      },
    });
    expect(
      await runtime.runReceipt(
        "00-1234567890abcdef1234567890abcdef-1234567890abcdef-00",
        (carrier) => {
          expect(carrier?.endsWith("-01")).toBe(true);
          return Promise.resolve("private_synthetic_business_result");
        },
      ),
    ).toBe("private_synthetic_business_result");
    await runtime.runBotApi(() =>
      Promise.resolve({
        kind: "delivered",
        providerMessageId: "private_synthetic_provider_message",
      }),
    );
    await runtime.shutdown();
    expect(captured.map((item) => item.path)).toEqual([
      "/v1/traces",
      "/v1/metrics",
    ]);
    expect(
      captured.every(
        (item) =>
          item.contentType === "application/json" && !item.authenticated,
      ),
    ).toBe(true);
    for (const item of captured) {
      expect(item.body).not.toContain("private_synthetic");
      expect(item.body).toContain("inside-telegram");
      expect(() => {
        JSON.parse(item.body);
      }).not.toThrow();
    }
    expect(captured[0]?.body).toContain("waitlist receipt");
    expect(captured[0]?.body).toContain("telegram sendMessage");
    expect(captured[1]?.body).toContain("inside.telegram.operations");
  } finally {
    try {
      await runtime?.shutdown();
    } finally {
      await new Promise<void>((resolve, reject) =>
        receiver.close((error) =>
          error === undefined ? resolve() : reject(error),
        ),
      );
    }
  }
});
