import { expect } from "@playwright/test";
import { afterAll, test } from "vitest";
import { z } from "zod";
import { createOwnedBrowserFixture } from "../support/owned-browser-fixture";
import { savedQuote, supportOffer } from "../fixtures/billing.fixtures";

const quoteInput = z.object({ productId: z.uuid() });
const fixture = createOwnedBrowserFixture("checkout-selection");
afterAll(() => fixture.close(), 30_000);

test("a late quote for the previous checkout selection cannot reenable payment", async () => {
  const { browsers, url } = await fixture.start();
  const chromium = browsers.get("chromium");
  if (!chromium) throw new Error("Missing Chromium");
  const page = await chromium.newPage();
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => {
    pageErrors.push(error.message);
  });
  const releaseOld = Promise.withResolvers<undefined>();
  const releaseCurrent = Promise.withResolvers<undefined>();
  try {
    let requests = 0;
    await page.route("**/api/account/billing/quote", async (route) => {
      const observed = ++requests;
      const payload = quoteInput.parse(route.request().postDataJSON());
      if (payload.productId === supportOffer.product?.id) {
        await releaseOld.promise;
        await route.fulfill({ json: { ok: true, value: savedQuote } });
      } else {
        if (observed === 3) await releaseCurrent.promise;
        await route.fulfill({ json: { ok: false, code: "quote_changed" } });
      }
    });
    await page.goto(url);
    await expect
      .poll(() => {
        expect(pageErrors).toEqual([]);
        return requests;
      })
      .toBe(1);
    await page.getByRole("button", { name: "Вариант B" }).click();
    const retry = page.getByRole("button", { name: "Обновить условия" });
    await expect(retry).toBeEnabled();
    await retry.click();
    await expect.poll(() => requests).toBe(3);
    const delivered = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/account/billing/quote") &&
        quoteInput.parse(response.request().postDataJSON()).productId ===
          supportOffer.product?.id,
    );
    releaseOld.resolve(undefined);
    expect(await (await delivered).finished()).toBeNull();
    releaseCurrent.resolve(undefined);
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: /^(?:Оплатить |Оформить подписку и оплатить )/u,
      }),
    ).toBeDisabled();
    await expect(retry).toBeEnabled();
  } finally {
    releaseOld.resolve(undefined);
    releaseCurrent.resolve(undefined);
    await page.close();
  }
}, 30_000);
