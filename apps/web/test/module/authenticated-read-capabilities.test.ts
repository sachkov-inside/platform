import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { sessionAdapter } from "@/shared/auth/session-adapter.server";
import { realBffSession } from "../support/real-bff-session";
import {
  interceptIdentityOutage,
  expectIdentityOutage,
} from "../support/identity-http";
let scope: Awaited<ReturnType<typeof realBffSession>>;
import { handleAccountPresentationRequest } from "@/_pages/account/api/account-presentation-route.server";
import { handleAccountProfileRequest } from "@/_pages/account/api/account-profile-route.server";
import { handleAuthoringMaterialsRequest } from "@/_pages/authoring-materials/api/authoring-materials-route.server";
import { handleReadBillingContact } from "@/features/billing-contact.server";
import { handleReadNotificationPreferences } from "@/features/notification-preferences.server";
import { handleAcceptedDocumentsRequest } from "@/features/accepted-documents.server";
import { handleBookmarkList } from "@/features/bookmarks.server";
import { handleHomePinReadRequest } from "@/features/product-order/api/home-pin-route.server";
import { readAuthenticatedBilling } from "@/entities/subscription.server";
import { loadTaskSubmissions } from "@/_pages/task-submissions/api/load-task-submissions.server";
import { loadSalesFunnelReport } from "@/_pages/sales-funnel-report/api/sales-funnel-report.server";
import { z } from "zod";

const request = () => new Request("https://inside.example.test/api/read");
const billingBackend = vi.fn();
const capabilities = [
  ["account presentation", handleAccountPresentationRequest],
  ["account profile", handleAccountProfileRequest],
  ["authoring materials", () => handleAuthoringMaterialsRequest(request())],
  ["billing contact", handleReadBillingContact],
  ["notification preferences", handleReadNotificationPreferences],
  ["accepted documents", handleAcceptedDocumentsRequest],
  ["bookmarks", () => handleBookmarkList(request())],
  ["home pin", handleHomePinReadRequest],
  [
    "billing resource",
    () => readAuthenticatedBilling(billingBackend, z.unknown()),
  ],
] as const;

beforeEach(() => {
  billingBackend.mockReset();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-16T10:00:00Z"));
});
afterEach(() => vi.useRealTimers());

it.each(capabilities)(
  "%s uses the common missing-session and provider-failure protocol",
  async (_name, read) => {
    for (const [kind, status] of [
      ["authentication_required", 401],
      ["identity_unavailable", 503],
    ] as const) {
      scope = await realBffSession(
        kind === "authentication_required"
          ? null
          : { refreshToken: "failed-reader-identity" },
      );
      const identity = interceptIdentityOutage();
      const response = await scope(read);
      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({ kind });
      expect(response.headers.get("cache-control")).toBe("no-store, private");
      expect(response.headers.get("vary")).toBe("cookie");
      if (kind === "identity_unavailable") expectIdentityOutage(identity);
      else expect(identity).not.toHaveBeenCalled();
    }
    expect(billingBackend).not.toHaveBeenCalled();
  },
);

it("task submissions and the sales report select the render session mode", async () => {
  scope = await realBffSession(null);
  const tokenReads = vi.spyOn(sessionAdapter, "accessToken");
  expect(await scope(() => loadTaskSubmissions({}, undefined))).toEqual({
    kind: "unauthorized",
  });
  expect(await scope(() => loadSalesFunnelReport({}))).toEqual({
    kind: "unauthorized",
  });
  expect(tokenReads).toHaveBeenCalledTimes(2);
  expect(tokenReads).toHaveBeenCalledWith("rsc");
});
