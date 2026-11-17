import { expect, test } from "@playwright/test";
import { commerceInterceptionPayments } from "../support/commerce-interception";

test("the common unpaid learner appears in people and pending payments through real web reads", async ({
  page,
  context,
  baseURL,
  viewport,
}) => {
  const backendPort = process.env["FAKE_BACKEND_PORT"];
  if (backendPort === undefined || baseURL === undefined)
    throw new Error("Navigation addresses are required");
  const { wrapSession } = await import("@logto/node");
  await context.addCookies([
    {
      name: "logto_inside-web-navigation",
      httpOnly: true,
      sameSite: "Lax",
      url: baseURL,
      value: await wrapSession(
        {
          accessToken: JSON.stringify({
            [`@http://127.0.0.1:${backendPort}`]: {
              token: "synthetic-commerce-owner",
              scope: "",
              // deterministic-test-allow wall-clock: the real Web process and Logto validate a live session; no domain assertion depends on the current date.
              expiresAt: Math.floor(Date.now() / 1000) + 3600,
            },
          }),
          idToken: "synthetic.commerce.owner",
          refreshToken: "synthetic-commerce-refresh",
        },
        "inside-navigation-logto-cookie-secret-key",
      ),
    },
  ]);
  const rows = page
    .getByRole("main")
    .locator("tbody tr:visible, li.admin-list-item:visible");
  const peopleRead = page.waitForResponse(
    (response) => new URL(response.url()).pathname === "/api/authoring/people",
  );
  await page.goto("/authoring/people");
  expect(await (await peopleRead).json()).toMatchObject({
    kind: "ready",
    items: [
      {
        displayName: "Участник Тестов",
        email: null,
        telegram: "linked",
        products: [],
      },
    ],
  });
  await expect(
    rows.getByText("Участник Тестов", { exact: true }),
  ).toBeVisible();
  if (viewport !== null && viewport.width >= 640)
    await expect(
      rows.getByText("@synthetic_learner", {
        exact: true,
      }),
    ).toBeVisible();
  await expect(rows).not.toContainText("light-learner@inside.test");
  await page.goto("/authoring/sales/payments");
  const assertPayment = async () => {
    await expect(rows).toHaveCount(1);
    await expect(
      rows.getByText("Учебный курс: от идеи к выпуску"),
    ).toBeVisible();
    await expect(
      rows.getByText("Участник Тестов", { exact: true }),
    ).toBeVisible();
    await expect(rows.getByText("Ждёт оплаты", { exact: true })).toBeVisible();
    await expect(rows.getByText(/14\s?900\s?₽/u)).toBeVisible();
  };
  await assertPayment();
  // A distinct BFF adapter reaches the same UI through Playwright's external-server boundary.
  await page.route(
    /\/api\/authoring\/billing\/owner-payments(?:\?|$)/u,
    (route) => route.fulfill({ json: commerceInterceptionPayments() }),
  );
  await page.reload();
  await assertPayment();
});
