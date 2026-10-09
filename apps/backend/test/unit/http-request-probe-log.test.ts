import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { observeHttpRequests } from "../../src/infrastructure/observability/http-request-log.js";

describe("production verification request log", () => {
  let server: FastifyInstance | undefined;

  afterEach(async () => {
    await server?.close();
    server = undefined;
    vi.restoreAllMocks();
  });

  it("names a marked bank probe without logging arbitrary header values", async () => {
    const infos = vi.spyOn(console, "info").mockImplementation(() => undefined);
    server = Fastify();
    observeHttpRequests(server, "api");
    server.post("/billing/tbank/notification", (_request, reply) =>
      reply.code(400).send({ code: "invalid_notification" }),
    );
    await server.inject({
      method: "POST",
      url: "/billing/tbank/notification",
      headers: {
        "x-inside-production-verify": "bank-webhook-rejection",
        authorization: "private-value-must-not-be-logged",
      },
    });
    const line: unknown = infos.mock.calls[0]?.[0];
    expect(typeof line).toBe("string");
    if (typeof line !== "string") throw new Error("request log missing");
    expect(
      z.record(z.string(), z.unknown()).parse(JSON.parse(line)),
    ).toMatchObject({
      event: "request_completed",
      method: "POST",
      route: "/billing/tbank/notification",
      statusCode: 400,
      probe: "production_verify",
    });
    expect(line).not.toContain("private-value-must-not-be-logged");
    expect(line).not.toContain("bank-webhook-rejection");
  });

  it.each([
    {
      name: "unmarked bank rejection",
      status: 400,
      method: "POST" as const,
      path: "/billing/tbank/notification",
      marker: undefined,
      payload: undefined,
    },
    {
      name: "unknown marker",
      status: 400,
      method: "POST" as const,
      path: "/billing/tbank/notification",
      marker: "arbitrary-private-value",
      payload: undefined,
    },
    {
      name: "bank payload",
      status: 400,
      method: "POST" as const,
      path: "/billing/tbank/notification",
      marker: "bank-webhook-rejection",
      payload: { PaymentId: "bank-payment" },
    },
    {
      name: "another route",
      status: 400,
      method: "POST" as const,
      path: "/other",
      marker: "bank-webhook-rejection",
      payload: undefined,
    },
    {
      name: "another method",
      status: 400,
      method: "GET" as const,
      path: "/billing/tbank/notification",
      marker: "bank-webhook-rejection",
      payload: undefined,
    },
    {
      name: "unexpected 401",
      status: 401,
      method: "POST" as const,
      path: "/billing/tbank/notification",
      marker: "bank-webhook-rejection",
      payload: undefined,
    },
    {
      name: "unexpected 503",
      status: 503,
      method: "POST" as const,
      path: "/billing/tbank/notification",
      marker: "bank-webhook-rejection",
      payload: undefined,
    },
  ])(
    "does not mark $name as a probe",
    async ({ method, path, marker, payload, status }) => {
      const infos = vi
        .spyOn(console, "info")
        .mockImplementation(() => undefined);
      server = Fastify();
      observeHttpRequests(server, "api");
      server.route({
        method,
        url: path,
        handler: (_request, reply) => reply.code(status).send(),
      });
      await server.inject({
        method,
        url: path,
        headers:
          marker === undefined ? {} : { "x-inside-production-verify": marker },
        ...(payload === undefined ? {} : { payload }),
      });
      const line: unknown = infos.mock.calls[0]?.[0];
      if (typeof line !== "string") throw new Error("request log missing");
      expect(
        z.record(z.string(), z.unknown()).parse(JSON.parse(line)),
      ).not.toHaveProperty("probe");
      expect(line).not.toContain("arbitrary-private-value");
      expect(line).not.toContain("bank-payment");
    },
  );
});
