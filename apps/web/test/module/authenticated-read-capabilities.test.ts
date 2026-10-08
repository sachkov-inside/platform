import { beforeEach, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ accessToken: vi.fn() }));
vi.mock("@/shared/auth/session-adapter.server", () => ({
  sessionAdapter: { accessToken: session.accessToken },
  LogtoSessionUnavailableError: class extends Error {},
}));
import { LogtoSessionUnavailableError } from "@/shared/auth/session-adapter.server";
import { handleAccountPresentationRequest } from "@/_pages/account/api/account-presentation-route.server";
import { handleAccountProfileRequest } from "@/_pages/account/api/account-profile-route.server";
import { handleAuthoringMaterialsRequest } from "@/_pages/authoring-materials/api/authoring-materials-route.server";
import { handleSavedPostList } from "@/_pages/communications/api/communications.server";
import { handleReadBillingContact } from "@/features/billing-contact.server";
import { handleReadNotificationPreferences } from "@/features/notification-preferences.server";
import { handleAcceptedDocumentsRequest } from "@/features/accepted-documents.server";
import { handleBookmarkList } from "@/features/bookmarks.server";
import { handleHomePinReadRequest } from "@/features/series-order/api/home-pin-route.server";
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
  ["communications", () => handleSavedPostList(request())],
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

beforeEach(() => vi.clearAllMocks());

it.each(capabilities)(
  "%s uses the common missing-session and provider-failure protocol",
  async (_name, read) => {
    for (const [error, kind, status] of [
      [new LogtoSessionUnavailableError(), "authentication_required", 401],
      [new Error("provider failed"), "identity_unavailable", 503],
    ] as const) {
      session.accessToken.mockRejectedValue(error);
      const response = await read();
      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({ kind });
      expect(response.headers.get("cache-control")).toBe("no-store, private");
      expect(response.headers.get("vary")).toBe("cookie");
    }
    expect(billingBackend).not.toHaveBeenCalled();
  },
);

it("task submissions and the sales report select the render session mode", async () => {
  session.accessToken.mockRejectedValue(new LogtoSessionUnavailableError());
  expect(await loadTaskSubmissions({}, undefined)).toEqual({
    kind: "unauthorized",
  });
  expect(await loadSalesFunnelReport({})).toEqual({ kind: "unauthorized" });
  expect(session.accessToken).toHaveBeenCalledTimes(2);
  expect(session.accessToken).toHaveBeenCalledWith("rsc");
});
