import { z } from "zod";
import {
  beginWaitlistSignIn,
  finishWaitlistSignIn,
} from "@/features/product-waitlist.sign-in.server";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
const fakes = vi.hoisted(() => ({
  token: vi.fn(),
  optional: vi.fn(),
  intake: vi.fn(),
  membership: vi.fn(),
  join: vi.fn(),
  withdraw: vi.fn(),
  account: vi.fn(),
  store: new Map<string, string>(),
}));
vi.mock("next/headers", () => ({
  cookies: () =>
    Promise.resolve({
      get: (key: string) => {
        const value = fakes.store.get(key);
        return value === undefined ? undefined : { value };
      },
      set: (key: string, value: string) => {
        fakes.store.set(key, value);
      },
      delete: (key: string) => {
        fakes.store.delete(key);
      },
    }),
}));
vi.mock("next/server", () => ({
  connection: () => Promise.resolve(),
  after: () => undefined,
}));
vi.mock("@/shared/api/backend/index.server", () => ({
  requestProductWaitlistIntake: fakes.intake,
  requestProductWaitlistMembership: fakes.membership,
  requestJoinProductWaitlist: fakes.join,
  requestWithdrawProductWaitlist: fakes.withdraw,
  resolveAccount: fakes.account,
}));
vi.mock("@/shared/auth/optional-platform-access-token.server", () => ({
  getOptionalPlatformAccessToken: fakes.optional,
}));
vi.mock("@/shared/auth/session-adapter.server", () => ({
  sessionAdapter: {
    accessToken: fakes.token,
    baseUrl: () => "http://127.0.0.1:3000",
  },
  LogtoSessionUnavailableError: class extends Error {},
}));
import {
  handleWaitlistIntent,
  handleWaitlistJoin,
  handleWaitlistRead,
} from "@/_pages/library-discovery/api/product-waitlist-route.server";
const productId = "10000000-0000-4000-8000-000000000001";
const intakeId = "10000000-0000-4000-8000-000000000002";
const accountId = "10000000-0000-4000-8000-000000000003";
const response = (body: unknown) => ({
  ok: true,
  body,
  response: new Response(),
});
function request(source?: string, origin = "http://127.0.0.1:3000") {
  return new Request("http://127.0.0.1:3000/api/product-waitlist/intent", {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify({ productId, source }),
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2030-03-01T12:00:00Z"));
  fakes.store.clear();
  fakes.optional.mockResolvedValue("trusted-token");
  fakes.token.mockResolvedValue("trusted-token");
  fakes.account.mockResolvedValue({ accountId });
  fakes.intake.mockResolvedValue(
    response({ intakeId, name: "Следующий набор" }),
  );
  fakes.membership.mockResolvedValue(
    response({ intakeId, name: "Следующий набор", active: false }),
  );
  fakes.join.mockResolvedValue(
    response({ intakeId, name: "Следующий набор", active: true }),
  );
});
afterEach(() => {
  vi.useRealTimers();
});
test("ordinary sign-in and a fabricated return address never create a membership", async () => {
  expect(await (await handleWaitlistJoin(request())).json()).toEqual({
    kind: "expired",
  });
  expect(fakes.join).not.toHaveBeenCalled();
});
test("explicit guest intent retains source through sign-in and consumes only after durable confirmation", async () => {
  fakes.optional.mockResolvedValue(undefined);
  const started = z
    .object({ kind: z.literal("sign-in"), returnTo: z.string() })
    .parse(await (await handleWaitlistIntent(request("youtube"))).json());
  expect(started).toMatchObject({ kind: "sign-in" });
  expect(await (await handleWaitlistJoin(request())).json()).toEqual({
    kind: "expired",
  });
  await beginWaitlistSignIn(started.returnTo);
  await finishWaitlistSignIn(started.returnTo, "trusted-token");
  expect(fakes.join).not.toHaveBeenCalled();
  const read = await handleWaitlistRead(
    new Request(
      `http://127.0.0.1:3000/api/product-waitlist?productId=${productId}`,
    ),
  );
  expect(await read.json()).toMatchObject({
    kind: "ready",
    active: false,
    continuation: true,
  });
  expect(await (await handleWaitlistJoin(request())).json()).toMatchObject({
    kind: "saved",
    active: true,
  });
  expect(fakes.join.mock.calls[0]?.[0]).toMatchObject({
    intakeId,
    source: "youtube",
  });
  expect(fakes.join.mock.calls[0]?.[1]).toBe("trusted-token");
  expect(await (await handleWaitlistJoin(request())).json()).toEqual({
    kind: "expired",
  });
  expect(fakes.join).toHaveBeenCalledTimes(1);
});
test("email Account links Telegram to that Account and preserves pending source; failure is never success", async () => {
  await handleWaitlistIntent(request("channel"));
  fakes.join.mockResolvedValueOnce({
    ok: false,
    problem: { code: "telegram_required" },
    response: new Response(null, { status: 409 }),
  });
  expect(await (await handleWaitlistJoin(request())).json()).toEqual({
    kind: "telegram-required",
  });
  expect(fakes.store.size).toBe(1);
  expect(await (await handleWaitlistJoin(request())).json()).toMatchObject({
    kind: "saved",
    active: true,
  });
  expect(fakes.join.mock.calls[1]?.[0]).toMatchObject({
    intakeId,
    source: "channel",
  });
});
test("cross-origin and Account switching reject a pending continuation", async () => {
  expect(
    (await handleWaitlistIntent(request("channel", "https://foreign.test")))
      .status,
  ).toBe(403);
  expect(fakes.store.size).toBe(0);
  await handleWaitlistIntent(request("channel"));
  fakes.account.mockResolvedValue({
    accountId: "10000000-0000-4000-8000-000000000004",
  });
  expect(await (await handleWaitlistJoin(request())).json()).toEqual({
    kind: "expired",
  });
  expect(fakes.join).not.toHaveBeenCalled();
});
test("server errors retain retryable intent and never claim durable success", async () => {
  await handleWaitlistIntent(request());
  fakes.join.mockResolvedValue({
    ok: false,
    problem: { code: "dependency_unavailable" },
    response: new Response(null, { status: 503 }),
  });
  expect(await (await handleWaitlistJoin(request())).json()).toEqual({
    kind: "unavailable",
  });
  expect(fakes.store.size).toBe(1);
});

test("ordinary new sign-in cancels an abandoned guest intent instead of later completing it", async () => {
  fakes.optional.mockResolvedValue(undefined);
  await handleWaitlistIntent(request("youtube"));
  await beginWaitlistSignIn("http://127.0.0.1:3000/");
  expect(await (await handleWaitlistJoin(request())).json()).toEqual({
    kind: "expired",
  });
  expect(fakes.join).not.toHaveBeenCalled();
});
