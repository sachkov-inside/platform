import { z } from "zod";
import { beforeEach, expect, it, vi } from "vitest";
vi.mock("@inside/legal", () => ({
  currentLegalEdition: () => ({ version: 3 }),
}));
vi.mock("@/shared/auth/index.server", () => ({
  readLogtoBffConfig: () => ({ baseUrl: "https://inside.example" }),
  isSameOriginMutation: (request: Request, base: string) =>
    request.headers.get("origin") === new URL(base).origin,
  readAuthenticatedSession: vi.fn(() =>
    Promise.resolve({
      kind: "authentication_required",
    }),
  ),
}));
vi.mock("@/shared/api/backend/index.server", () => ({
  resolveAccount: vi.fn(),
}));
import {
  handleAnalyticsCapture,
  handleAnalyticsConfig,
} from "@/features/storage-notice/api/capture.server";
import { readAuthenticatedSession } from "@/shared/auth/index.server";
import { resolveAccount } from "@/shared/api/backend/index.server";

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
      url: "/products/:slug",
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
  vi.mocked(readAuthenticatedSession).mockResolvedValue({
    kind: "ready",
    value: "token-A",
  });
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
  vi.mocked(readAuthenticatedSession).mockResolvedValue({
    kind: "authentication_required",
  });
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
