import { createServer, request } from "node:http";
import { once } from "node:events";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { expect, test, vi } from "vitest";
import { z } from "zod";
import { createApiApplication } from "../../src/entrypoints/api/create-api-application.js";
import { parsePlatformConfig } from "../../src/config/platform-config.js";
import { createMigratedTestDatabase } from "./setup/test-database.js";
import { startTestIdentityIssuer } from "./setup/test-identity-issuer.js";
import { registerFixedClock } from "../support/fixed-clock.js";

registerFixedClock();
const parent = "00-1234567890abcdef1234567890abcdef-1234567890abcdef-01";
const spanSchema = z.object({
  name: z.string(),
  traceId: z.string(),
  parentSpanId: z.string().optional(),
  kind: z.number(),
});
const exportSchema = z.object({
  resourceSpans: z
    .array(
      z.object({
        scopeSpans: z.array(z.object({ spans: z.array(spanSchema) })),
      }),
    )
    .optional(),
});

/** Real API + migrated PG + native flat raw headers. No mocked controller or business facet. */
test("only post-auth decoded confirmations admit one canonical Node-parsed parent, including normalized OWS", async () => {
  const db = await createMigratedTestDatabase();
  let app: NestFastifyApplication | undefined;
  let issuer: Awaited<ReturnType<typeof startTestIdentityIssuer>> | undefined;
  const exported: z.infer<typeof spanSchema>[] = [];
  let parseFailures = 0;
  const collector = createServer((req, res) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk: string) => {
      body += chunk;
    });
    req.on("end", () => {
      if (req.url === "/v1/traces") {
        let value: unknown;
        try {
          value = JSON.parse(body);
        } catch {
          parseFailures += 1;
        }
        const parsed = exportSchema.safeParse(value);
        if (!parsed.success) parseFailures += 1;
        if (parsed.success)
          exported.push(
            ...(parsed.data.resourceSpans ?? []).flatMap((resource) =>
              resource.scopeSpans.flatMap((scope) => scope.spans),
            ),
          );
      }
      res.writeHead(200, { "content-type": "application/json" }).end("{}");
    });
  });
  try {
    collector.listen(0, "127.0.0.1");
    await once(collector, "listening");
    const address = collector.address();
    if (address === null || typeof address === "string")
      throw new Error("Owned collector address unavailable");
    issuer = await startTestIdentityIssuer({
      issuer: "https://waitlist-parent.test",
      audience: "https://waitlist-parent.test/api",
    });
    vi.stubEnv("INSIDE_OTEL_ENABLED", "true");
    vi.stubEnv("INSIDE_OTEL_ENDPOINT", `http://127.0.0.1:${address.port}`);
    vi.stubEnv("INSIDE_OTEL_SAMPLE_RATIO", "1");
    const config = parsePlatformConfig({
      NODE_ENV: "test",
      DATABASE_URL: db.url,
      LOGTO_ISSUER: issuer.issuer,
      LOGTO_AUDIENCE: issuer.audience,
      LOGTO_JWKS_URL: issuer.jwksUrl,
      TELEGRAM_COMMUNICATIONS_ENDPOINT:
        "http://127.0.0.1:1/integrations/platform/v1/communications",
      TELEGRAM_COMMUNICATIONS_SECRET: "synthetic-receipt-secret",
      TELEGRAM_AUTHOR_AUTHORIZATION_SECRET: "synthetic-authorization-secret",
      TELEGRAM_COMMUNICATIONS_BOT_IDENTITY: "synthetic-bot",
    });
    app = await createApiApplication(config, { logger: false });
    await app.listen(0, "127.0.0.1");
    const url = new URL(
      "/integrations/telegram/v1/communications/waitlist",
      await app.getUrl(),
    );
    const command = {
      contractVersion: "inside.waitlist-confirmation.v1",
      eventId: "00000000-0000-4000-8000-000000000041",
      intakeId: "00000000-0000-4000-8000-000000000042",
      accountRef: "synthetic-account",
      telegramIdentityRef: "synthetic-identity",
      linkRevision: 1,
    };
    async function post(
      fields: string[],
      body: object = command,
      authorized = true,
    ) {
      return new Promise<{ status: number | undefined; body: unknown }>(
        (resolve, reject) => {
          const req = request(
            url,
            {
              method: "POST",
              headers: [
                "Host",
                url.host,
                "Content-Type",
                "application/json",
                "Authorization",
                authorized
                  ? "Bearer synthetic-authorization-secret"
                  : "Bearer wrong",
                ...fields,
              ],
            },
            (res) => {
              let body = "";
              res.setEncoding("utf8");
              res.on("data", (chunk: string) => {
                body += chunk;
              });
              res.on("end", () => {
                try {
                  resolve({ status: res.statusCode, body: JSON.parse(body) });
                } catch (error) {
                  reject(
                    new Error("Owned response was not JSON", { cause: error }),
                  );
                }
              });
            },
          );
          req.on("error", reject);
          req.end(JSON.stringify(body));
        },
      );
    }
    const valid = [
      ["TraceParent", parent],
      ["traceparent", parent.slice(0, -2) + "00"],
      ["TRACEPARENT", " " + parent + " "],
    ];
    const invalid = [
      [],
      ["traceparent", parent, "TraceParent", parent],
      ["traceparent", parent + "," + parent],
      ["traceparent", parent.toUpperCase()],
      [
        "traceparent",
        "00-00000000000000000000000000000000-1234567890abcdef-01",
      ],
      [
        "traceparent",
        "00-1234567890abcdef1234567890abcdef-0000000000000000-01",
      ],
      ["traceparent", "01" + parent.slice(2)],
      ["traceparent", parent.slice(0, -2) + "02"],
      ["traceparent", parent + "-extra"],
      ["traceparent", parent.slice(0, 10) + " " + parent.slice(10)],
    ];
    for (const fields of [...valid, ...invalid])
      expect(await post(fields)).toEqual({
        status: 200,
        body: { eventId: command.eventId, status: "suppressed" },
      });
    expect((await post(["traceparent", parent], command, false)).status).toBe(
      401,
    );
    expect(
      (
        await post(["traceparent", parent], {
          ...command,
          privateExtra: "not-allowed",
        })
      ).status,
    ).toBe(400);
    await app.close();
    app = undefined;
    expect(parseFailures).toBe(0);
    const continuations = exported.filter(
      (span) => span.name === "waitlist authorize",
    );
    expect(continuations).toHaveLength(valid.length + invalid.length);
    expect(
      continuations.filter(
        (span) => span.traceId === "1234567890abcdef1234567890abcdef",
      ),
    ).toHaveLength(valid.length);
    expect(
      continuations.filter((span) => span.parentSpanId === "1234567890abcdef"),
    ).toHaveLength(valid.length);
    expect(continuations.every((span) => span.kind === 1)).toBe(true);
    const servers = exported.filter((span) => span.kind === 2);
    expect(servers).toHaveLength(valid.length + invalid.length + 2);
    expect(
      servers.every(
        (span) => span.parentSpanId === undefined || span.parentSpanId === "",
      ),
    ).toBe(true);
  } finally {
    await app?.close();
    collector.closeAllConnections();
    if (collector.listening)
      await new Promise<void>((resolve, reject) =>
        collector.close((error) => (error ? reject(error) : resolve())),
      );
    await issuer?.close();
    vi.unstubAllEnvs();
    await db.dispose();
  }
});
