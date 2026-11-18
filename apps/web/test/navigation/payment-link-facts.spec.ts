import { expect, test, type Route } from "@playwright/test";
import { z } from "zod";

import { authoringScenario } from "../../../../scenarios/authoring.mjs";

const backendPort = process.env["FAKE_BACKEND_PORT"];
if (backendPort === undefined) throw new Error("FAKE_BACKEND_PORT is required");
const backend = `http://127.0.0.1:${backendPort}`;
const architectureId = authoringScenario.products.architecture.id;
const linkReply = z.object({
  ok: z.literal(true),
  value: z.object({
    result: z.object({
      outcome: z.literal("paymentLinks"),
      items: z.array(z.unknown()),
      nextCursor: z.string().nullable(),
    }),
  }),
});

async function authorCookie(baseURL: string) {
  const { wrapSession } = await import("@logto/node");
  const session = await wrapSession(
    {
      accessToken: JSON.stringify({
        [`@${backend}`]: {
          // deterministic-test-allow wall-clock: The live Web process and Logto validate this session against their real clock; it carries no calendar-dependent domain assertion.
          expiresAt: Math.floor(Date.now() / 1_000) + 3_600,
          scope: "",
          token: "collections-author",
        },
      }),
      idToken: "collections.id.token",
      refreshToken: "collections-refresh-token",
    },
    "inside-navigation-logto-cookie-secret-key",
  );
  return {
    httpOnly: true,
    name: "logto_inside-web-navigation",
    sameSite: "Lax" as const,
    url: baseURL,
    value: session,
  };
}

test("price archive starts an authoritative link read before the pre-write BFF reply is released (#2392)", async ({
  context,
  page,
  request,
  baseURL,
}) => {
  if (baseURL === undefined) throw new Error("baseURL required");
  expect(
    (
      await request.post(`${backend}/__control`, {
        data: { delayMs: 0, unavailable: false },
      })
    ).ok(),
  ).toBe(true);
  expect((await request.post(`${backend}/__collections/reset`)).ok()).toBe(
    true,
  );
  expect((await request.post(`${backend}/__product-sale/reset`)).ok()).toBe(
    true,
  );
  await context.addCookies([await authorCookie(baseURL)]);
  const held = Promise.withResolvers<undefined>();
  const firstAccepted = Promise.withResolvers<undefined>();
  const firstFinished = Promise.withResolvers<undefined>();
  const secondAccepted = Promise.withResolvers<undefined>();
  // Both promises are also awaited below, including transport failure paths.
  void firstAccepted.promise.catch(() => undefined);
  void secondAccepted.promise.catch(() => undefined);
  let reads = 0;
  const firstState = { started: false };
  const handleList = async (route: Route) => {
    reads += 1;
    const first = reads === 1;
    if (first) firstState.started = true;
    try {
      const reply = await route.fetch();
      expect(reply.status()).toBe(200);
      linkReply.parse(await reply.json());
      if (first) {
        firstAccepted.resolve(undefined);
        await held.promise;
      } else {
        secondAccepted.resolve(undefined);
      }
      await route.fulfill({ response: reply });
    } catch (error) {
      if (first) firstAccepted.reject(error);
      else secondAccepted.reject(error);
      throw error;
    } finally {
      if (first) firstFinished.resolve(undefined);
    }
  };
  await page.route("**/api/authoring/billing/payment-links/list", handleList);
  try {
    await page.goto(`/authoring/products/${architectureId}?tab=sale`);
    await firstAccepted.promise;
    const panel = page.getByRole("tabpanel", { name: "Продажа" });
    await panel
      .getByRole("button", {
        name: "Действия с ценой «Архитектура приложения»",
      })
      .click();
    await page.getByRole("menuitem", { name: "Архивировать цену" }).click();
    const archiving = page.getByRole("dialog", { name: "Архивировать цену?" });
    const written = page.waitForResponse(
      (reply) =>
        reply.url().endsWith("/api/authoring/billing/product-prices/archive") &&
        reply.request().method() === "POST",
    );
    await archiving.getByRole("button", { name: "Архивировать цену" }).click();
    const write = await written;
    expect(write.status()).toBe(200);
    z.object({ ok: z.literal(true) }).parse(await write.json());
    await expect(panel).toContainText("Цена в архиве");
    await expect.poll(() => reads).toBe(2);
    await secondAccepted.promise;
    held.resolve(undefined);
    await firstFinished.promise;
    await expect(panel.getByText("Ссылок на оплату пока нет")).toBeVisible();
    await expect(panel).toContainText("Цена в архиве");
    expect(reads).toBe(2);
  } finally {
    held.resolve(undefined);
    if (firstState.started) await firstFinished.promise;
    await page.unroute(
      "**/api/authoring/billing/payment-links/list",
      handleList,
    );
  }
});
