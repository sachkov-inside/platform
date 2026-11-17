import { beforeEach, expect, test, vi } from "vitest";
import { configureWebRuntime } from "../support/web-runtime";
import {
  interceptBackendHttp,
  expectSingleBackendRequest,
} from "../support/backend-http";
const backend = vi.fn<(request: Request) => Promise<Response>>();

import {
  handleTrackingVisit,
  handleTrackingHead,
  classifyTrackingTraffic,
} from "@/_pages/communication-tracking/api/tracking-route.server";
beforeEach(() => {
  backend.mockReset();
  configureWebRuntime();
  interceptBackendHttp(backend);
});
test("redirect records known previews, ignores caller URLs, disables cache/referrer and does not grant content access", async () => {
  backend.mockResolvedValue(
    Response.json({
      kind: "resolved",
      safeUrl: "https://inside.test/materials/protected",
    }),
  );
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
  expect(
    await expectSingleBackendRequest(
      backend,
      "POST",
      "/communications/tracking/resolve",
      null,
    ).json(),
  ).toEqual({
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
  expect(backend).not.toHaveBeenCalled();
  backend.mockResolvedValue(Response.json({ kind: "unavailable" }));
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
