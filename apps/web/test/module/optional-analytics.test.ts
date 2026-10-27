import { z } from "zod";
import { beforeEach, expect, it, vi } from "vitest";
vi.mock("@inside/legal", () => ({
  currentLegalEdition: () => ({ version: fakes.legalVersion }),
}));
const fakes = vi.hoisted(() => ({
  token: vi.fn<() => Promise<string | undefined>>(),
  legalVersion: 3,
}));
vi.mock("@/shared/auth/logto-bff-config.server", () => ({
  readLogtoBffConfig: () => ({ baseUrl: "https://inside.example" }),
}));
vi.mock("@/shared/auth/optional-platform-access-token.server", () => ({
  getOptionalPlatformAccessToken: fakes.token,
}));
vi.mock("@/shared/api/backend/index.server", () => ({
  resolveAccount: vi.fn(),
  requestReaderReference: vi.fn(),
}));
import {
  handleAnalyticsCapture,
  handleAnalyticsConfig,
} from "@/features/storage-notice/api/capture.server";
import {
  requestReaderReference,
  resolveAccount,
} from "@/shared/api/backend/index.server";

const outboundSchema = z.object({
  type: z.literal("event"),
  payload: z.strictObject({
    website: z.uuid(),
    hostname: z.string(),
    url: z.string(),
    data: z.unknown(),
    ip: z.string(),
    userAgent: z.string(),
    id: z.string().optional(),
  }),
});
function outbound(body: BodyInit | null | undefined) {
  if (typeof body !== "string") throw new Error("JSON body required");
  return outboundSchema.parse(JSON.parse(body));
}
const event = {
  revision: "3",
  entityId: "10000000-0000-4000-8000-000000000001",
  event: "product_view",
  campaign: "telegram",
  referrer: "telegram",
};
const request = (body: unknown = event, origin = "https://inside.example") =>
  new Request("https://inside.example/api/analytics", {
    method: "POST",
    headers: {
      origin,
      "content-type": "application/json",
      "user-agent": "Mozilla/5.0",
      "x-forwarded-for": "192.0.2.4",
    },
    body: JSON.stringify(body),
  });
beforeEach(() => {
  fakes.legalVersion = 3;
  fakes.token.mockResolvedValue(undefined);
  vi.mocked(requestReaderReference).mockImplementation((kind, id) =>
    Promise.resolve({
      ok: true,
      response: Response.json({}),
      body: { id, kind, availability: "available" },
    }),
  );
  vi.stubEnv("INSIDE_ANALYTICS_ENABLED", "true");
  vi.stubEnv("INSIDE_ANALYTICS_LEGAL_REVISION", "3");
  vi.stubEnv("INSIDE_UMAMI_ENDPOINT", "http://umami-ingest:3000/api/send");
  vi.stubEnv("INSIDE_UMAMI_WEBSITE_ID", "00000000-0000-4000-8000-000000000001");
  vi.stubEnv("INSIDE_ANALYTICS_PSEUDONYM_SECRET", "a".repeat(32));
});
it("does not collect until the switch and accepted legal revision both match", async () => {
  const send = vi.fn();
  vi.stubGlobal("fetch", send);
  vi.stubEnv("INSIDE_ANALYTICS_ENABLED", "false");
  expect((await handleAnalyticsCapture(request())).status).toBe(200);
  expect(await handleAnalyticsConfig().json()).toEqual({
    enabled: false,
  });
  vi.stubEnv("INSIDE_ANALYTICS_ENABLED", "true");
  vi.stubEnv("INSIDE_ANALYTICS_LEGAL_REVISION", "2");
  expect((await handleAnalyticsCapture(request())).status).toBe(200);
  expect(send).not.toHaveBeenCalled();
  fakes.legalVersion = 2;
  vi.stubEnv("INSIDE_ANALYTICS_LEGAL_REVISION", "2");
  expect(await handleAnalyticsConfig().json()).toEqual({ enabled: false });
  expect(await (await handleAnalyticsCapture(request())).json()).toEqual({
    accepted: false,
  });
  expect(send).not.toHaveBeenCalled();
});
it("validates privacy before export, accepts only same-origin bounded closed events", async () => {
  const send = vi.fn<typeof fetch>(() =>
    Promise.resolve(new Response(null, { status: 204 })),
  );
  vi.stubGlobal("fetch", send);
  for (const body of [
    { ...event, url: "/products/private?email=secret" },
    { ...event, event: "payment_confirmed" },
    { ...event, campaign: "email@example.com" },
    { ...event, revision: "2" },
  ])
    expect((await handleAnalyticsCapture(request(body))).status).toBe(400);
  expect(
    (await handleAnalyticsCapture(request(event, "https://evil.example")))
      .status,
  ).toBe(403);
  expect((await handleAnalyticsCapture(request("x".repeat(4097)))).status).toBe(
    413,
  );
  expect(send).not.toHaveBeenCalled();
  expect((await handleAnalyticsCapture(request())).status).toBe(200);
  expect(send).toHaveBeenCalledOnce();
  const [, init] = send.mock.calls[0] ?? [];
  const payload = outbound(init?.body);
  expect(payload).toEqual({
    type: "event",
    payload: {
      website: "00000000-0000-4000-8000-000000000001",
      hostname: "inside.example",
      url: "/products/10000000-0000-4000-8000-000000000001?utm_source=telegram&utm_medium=telegram",
      data: {
        observation: "browser",
        event: "product_view",
        campaign: "telegram",
        referrer: "telegram",
      },
      ip: "192.0.2.4",
      userAgent: "Mozilla/5.0",
    },
  });
});
it("derives identity only from the current trusted Account, with no retained binding after logout", async () => {
  const send = vi.fn<typeof fetch>(() =>
    Promise.resolve(new Response(null, { status: 200 })),
  );
  vi.stubGlobal("fetch", send);
  fakes.token.mockResolvedValue("token-A");
  vi.mocked(resolveAccount).mockResolvedValue({
    accountId: "00000000-0000-4000-8000-000000000002",
  });
  await handleAnalyticsCapture(request());
  const identified = outbound(send.mock.calls[0]?.[1]?.body);
  expect(identified.payload.id).toMatch(/^[a-f0-9]{64}$/);
  expect(JSON.stringify(identified)).not.toContain("token-A");
  expect(JSON.stringify(identified)).not.toContain(
    "00000000-0000-4000-8000-000000000002",
  );
  vi.mocked(resolveAccount).mockResolvedValue({
    accountId: "00000000-0000-4000-8000-000000000003",
  });
  await handleAnalyticsCapture(request());
  const switched = outbound(send.mock.calls[1]?.[1]?.body);
  expect(switched.payload.id).toMatch(/^[a-f0-9]{64}$/);
  expect(switched.payload.id).not.toBe(identified.payload.id);
  fakes.token.mockResolvedValue(undefined);
  await handleAnalyticsCapture(request());
  expect(outbound(send.mock.calls[2]?.[1]?.body).payload.id).toBeUndefined();
});
it("rejects a forged forwarded value at the existing ingress client boundary", async () => {
  const send = vi.fn<typeof fetch>(() =>
    Promise.resolve(new Response(null, { status: 204 })),
  );
  vi.stubGlobal("fetch", send);
  const input = request();
  input.headers.set("x-forwarded-for", "personal-secret.example");
  await handleAnalyticsCapture(input);
  expect(outbound(send.mock.calls[0]?.[1]?.body).payload.ip).toBe(
    "unidentified",
  );
});

it("the common optional boundary applies the declared 1 KiB ceiling before resolving a session", async () => {
  const send = vi.fn();
  vi.stubGlobal("fetch", send);
  fakes.token.mockClear();
  const advertised = request();
  advertised.headers.set("content-length", "1025");
  expect((await handleAnalyticsCapture(advertised)).status).toBe(413);
  expect(
    (
      await handleAnalyticsCapture(
        request({ ...event, extra: "x".repeat(1024) }),
      )
    ).status,
  ).toBe(413);
  expect(
    (
      await handleAnalyticsCapture(
        request({ ...event, entityId: "private-slug@example.com" }),
      )
    ).status,
  ).toBe(400);
  const otherType = request();
  otherType.headers.set("content-type", "text/plain");
  expect((await handleAnalyticsCapture(otherType)).status).toBe(400);
  expect(fakes.token).not.toHaveBeenCalled();
  expect(send).not.toHaveBeenCalled();
});

it("exports only owner-confirmed business UUIDs and refuses a locked body observation", async () => {
  const send = vi.fn<typeof fetch>(() => Promise.resolve(Response.json({})));
  vi.stubGlobal("fetch", send);
  vi.mocked(requestReaderReference).mockResolvedValueOnce({
    ok: false,
    problem: {},
    response: new Response(null, { status: 404 }),
  });
  expect((await handleAnalyticsCapture(request())).status).toBe(400);
  vi.mocked(requestReaderReference).mockResolvedValueOnce({
    ok: true,
    response: Response.json({}),
    body: {
      id: "10000000-0000-4000-8000-000000000009",
      kind: "product",
      availability: "available",
    },
  });
  expect((await handleAnalyticsCapture(request())).status).toBe(503);
  vi.mocked(requestReaderReference).mockResolvedValueOnce({
    ok: true,
    response: Response.json({}),
    body: { id: event.entityId, kind: "material", availability: "locked" },
  });
  expect(
    (
      await handleAnalyticsCapture(
        request({ ...event, event: "material_view" }),
      )
    ).status,
  ).toBe(400);
  vi.mocked(requestReaderReference).mockRejectedValueOnce(
    new Error("private owner failure"),
  );
  expect((await handleAnalyticsCapture(request())).status).toBe(503);
  expect(send).not.toHaveBeenCalled();
  fakes.token.mockResolvedValue("token-A");
  vi.mocked(resolveAccount).mockResolvedValue({
    accountId: "20000000-0000-4000-8000-000000000001",
  });
  vi.mocked(requestReaderReference).mockResolvedValueOnce({
    ok: true,
    response: Response.json({}),
    body: { id: event.entityId, kind: "material", availability: "locked" },
  });
  expect(
    (
      await handleAnalyticsCapture(
        request({ ...event, event: "access_restricted" }),
      )
    ).status,
  ).toBe(200);
  expect(requestReaderReference).toHaveBeenLastCalledWith(
    "material",
    event.entityId,
    "token-A",
  );
  expect(outbound(send.mock.calls[0]?.[1]?.body).payload.url).toContain(
    `/materials/${event.entityId}/locked?`,
  );
});
