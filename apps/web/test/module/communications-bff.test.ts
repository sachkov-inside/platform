import { beforeEach, expect, test, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  visit: vi.fn(),
  session: vi.fn(),
}));
vi.mock("@/shared/api/backend/index.server", () => ({
  requestCommunications: mocks.request,
  requestCommunicationVisit: mocks.visit,
  requestCommunicationsTemplate: mocks.request,
}));
vi.mock("@/shared/auth/platform-access-token.server", () => ({
  getPlatformAccessToken: mocks.session,
  LogtoSessionUnavailableError: class extends Error {},
}));
vi.mock("@/shared/auth/logto-bff-config.server", () => ({
  readLogtoBffConfig: () => ({ baseUrl: "https://inside.test" }),
}));
import {
  handleBroadcastLaunch,
  handleBroadcastPause,
  handleBroadcastResume,
  handleBroadcastCancel,
  handleBroadcastSave,
} from "@/_pages/communications/api/communications.server";
import {
  handleTrackingVisit,
  handleTrackingHead,
  classifyTrackingTraffic,
} from "@/_pages/communications/api/tracking-route.server";
const broadcastId = "10000000-0000-4000-8000-000000000001";
const operationId = "10000000-0000-4000-8000-000000000002";
const input = { operationId, expectedRevision: 2, payload: { broadcastId } };
function request(value: unknown, origin = "https://inside.test") {
  const form = new FormData();
  form.set("input", JSON.stringify(value));
  return new Request(
    "https://inside.test/api/communications/broadcasts/launch",
    { method: "POST", headers: { origin }, body: form },
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue("delegated-token");
  mocks.request.mockResolvedValue({
    ok: false,
    problem: { code: "revision_conflict" },
    response: new Response(null, { status: 409 }),
  });
});
test("named BFF writes preserve operation ID/revision on repeated requests and derive lifecycle action", async () => {
  for (const [handler, operation, action] of [
    [handleBroadcastLaunch, "broadcasts.launch", null],
    [handleBroadcastPause, "broadcasts.lifecycle", "pause"],
    [handleBroadcastResume, "broadcasts.lifecycle", "resume"],
    [handleBroadcastCancel, "broadcasts.lifecycle", "cancel"],
  ] as const) {
    for (let i = 0; i < 2; i++) {
      const response = await handler(request(input));
      expect(response.headers.get("cache-control")).toContain("no-store");
      expect(await response.json()).toEqual({
        kind: "error",
        code: "revision_conflict",
      });
      expect(mocks.request).toHaveBeenLastCalledWith(
        {
          ...input,
          contractVersion: "inside-communications-v1",
          operation,
          payload: action ? { broadcastId, action } : { broadcastId },
        },
        "delegated-token",
      );
    }
  }
});
test("cross-origin and malformed saves cannot reach the provider", async () => {
  expect(
    (await handleBroadcastLaunch(request(input, "https://evil.test"))).status,
  ).toBe(403);
  expect(await (await handleBroadcastSave(request(input))).json()).toEqual({
    kind: "error",
    code: "invalid_input",
  });
  expect(mocks.request).not.toHaveBeenCalled();
});
test("redirect records known previews, ignores caller URLs, disables cache/referrer and does not grant content access", async () => {
  mocks.visit.mockResolvedValue({
    ok: true,
    body: {
      kind: "resolved",
      safeUrl: "https://inside.test/materials/protected",
    },
  });
  const response = await handleTrackingVisit(
    new Request(
      `https://inside.test/communications/visit?token=${"a".repeat(43)}&url=https://evil.test`,
      { headers: { "user-agent": "TelegramBot (like TwitterBot)" } },
    ),
  );
  expect(response.status).toBe(302);
  expect(response.headers.get("location")).toBe(
    "https://inside.test/materials/protected",
  );
  expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  expect(response.headers.get("cache-control")).toContain("no-store");
  expect(mocks.visit).toHaveBeenCalledWith({
    token: "a".repeat(43),
    traffic: "known_automation",
  });
  expect(classifyTrackingTraffic("Mozilla/5.0")).toBe("unknown");
  expect(handleTrackingHead().status).toBe(405);
});
test("invalid or unresolved tokens have a safe failure with no arbitrary redirect", async () => {
  expect(
    (
      await handleTrackingVisit(
        new Request("https://inside.test/communications/visit?token=invalid"),
      )
    ).status,
  ).toBe(404);
  expect(mocks.visit).not.toHaveBeenCalled();
  mocks.visit.mockResolvedValue({ ok: true, body: { kind: "unavailable" } });
  expect(
    (
      await handleTrackingVisit(
        new Request(
          `https://inside.test/communications/visit?token=${"a".repeat(43)}`,
        ),
      )
    ).status,
  ).toBe(503);
});
