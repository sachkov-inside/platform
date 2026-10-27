import { beforeEach, expect, test, vi } from "vitest";
const mocks = vi.hoisted(() => ({ visit: vi.fn() }));
vi.mock("@/shared/api/backend/index.server", () => ({
  requestCommunicationVisit: mocks.visit,
}));
import {
  handleTrackingVisit,
  handleTrackingHead,
  classifyTrackingTraffic,
} from "@/_pages/communication-tracking/api/tracking-route.server";
beforeEach(() => {
  vi.clearAllMocks();
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
