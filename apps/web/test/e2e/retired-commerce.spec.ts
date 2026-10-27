import { expect, test } from "@playwright/test";
const retired = [
  "/api/account/billing/subscription/cancel",
  "/api/account/billing/subscription/resume",
  "/api/account/billing/subscription/change",
  "/api/account/billing/payment-method/change",
  "/api/account/billing/payment-method/revoke",
  "/api/account/billing/enrollments",
  "/api/authoring/billing/offers/save",
  "/api/authoring/billing/payment-options/save",
  "/api/authoring/billing/invitations/issue",
  "/api/authoring/billing/tribute/apply",
  "/api/authoring/billing/enrollments/assign",
  "/api/authoring/billing/grants/extend",
  "/api/authoring/billing/grants/classify",
];
test("retired commerce has no browser route that can be re-enabled", async ({
  request,
}) => {
  for (const path of retired) {
    const response = await request.post(path, {
      data: { operationId: "00000000-0000-4000-8000-000000000001" },
    });
    expect(response.status(), path).toBe(404);
  }
});
test("subscription screens have been removed", async ({ page }) => {
  for (const path of ["/subscription", "/account/subscription"]) {
    const response = await page.goto(path);
    expect(response?.status(), path).toBe(404);
  }
});
