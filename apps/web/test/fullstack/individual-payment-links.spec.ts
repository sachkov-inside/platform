import { randomUUID } from "node:crypto";
import { productCapability } from "@inside/access-capabilities";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { z } from "zod";
import {
  fullStackBrowserRequest,
  signInFullStack,
} from "../support/full-stack-session";
import { screenshotWholePage } from "../support/whole-page-screenshot.mjs";
import {
  evidencePath,
  prepareEvidenceDirectory,
} from "../../../../scripts/evidence-path.mjs";

/** Real production route and BFF with synthetic records in the disposable full-stack database. */
test("individual payment link shows its fixed private price and actual terms, then rejects revocation in the buyer page", async ({
  page,
  context,
  browser,
}, testInfo) => {
  await signInFullStack(context, "OWNER");
  await page.goto("/authoring/billing");
  const content = await fullStackBrowserRequest(
    page,
    "/api/authoring/billing/content/list",
    "POST",
    { input: JSON.stringify({ operationId: randomUUID() }) },
  );
  const parsed = z
    .object({
      ok: z.literal(true),
      value: z.object({
        result: z.object({
          items: z.array(
            z.object({
              id: z.uuid(),
              kind: z.string(),
              title: z.string(),
              available: z.boolean(),
            }),
          ),
        }),
      }),
    })
    .parse(await content.json());
  const product = parsed.value.result.items.find(
    (entry) => entry.kind === "product" && entry.available,
  );
  if (product === undefined)
    throw new Error("Seeded published Product is missing");
  const offerId = randomUUID(),
    optionId = randomUUID();
  const saved = await fullStackBrowserRequest(
    page,
    "/api/authoring/billing/offers/save",
    "POST",
    {
      input: JSON.stringify({
        operationId: randomUUID(),
        value: {
          id: offerId,
          name: `Private synthetic ${offerId}`,
          benefits: [productCapability(product.id), "support"],
          benefitPeriods: [
            { capability: productCapability(product.id), months: null },
            { capability: "support", months: 6 },
          ],
          coverage: { productIds: [product.id], materialIds: [] },
        },
      }),
    },
  );
  expect(await saved.json()).toMatchObject({ ok: true });
  const priced = await fullStackBrowserRequest(
    page,
    "/api/authoring/billing/payment-options/save",
    "POST",
    {
      input: JSON.stringify({
        operationId: randomUUID(),
        value: {
          id: optionId,
          offerId,
          mode: "one_time",
          months: 6,
          priceKopecks: 2900000,
        },
      }),
    },
  );
  expect(await priced.json()).toMatchObject({ ok: true });
  const created = await fullStackBrowserRequest(
    page,
    "/api/authoring/billing/payment-links/create",
    "POST",
    {
      input: JSON.stringify({
        operationId: randomUUID(),
        paymentOptionId: optionId,
        optionRevision: 1,
        price: { kind: "discount", percent: 10 },
        expiresAt: null,
      }),
    },
  );
  const link = z
    .object({
      ok: z.literal(true),
      value: z.object({
        result: z.object({
          value: z.object({ id: z.uuid(), revision: z.int() }),
        }),
      }),
    })
    .parse(await created.json()).value.result.value;
  await page.reload();
  const heading = page.getByRole("heading", {
    name: "Ссылки на оплату",
    exact: true,
  });
  await heading.scrollIntoViewIfNeeded();
  await expect(
    page.getByText("26 100", { exact: false }).first(),
  ).toBeVisible();
  const guest = await browser.newContext({
    viewport: page.viewportSize() ?? { width: 1440, height: 1024 },
  });
  const buyer = await guest.newPage();
  const path = `/payment/links/${link.id}`;
  const response = await buyer.goto(path);
  expect(response?.headers()["referrer-policy"]).toBe("no-referrer");
  expect(response?.headers()["cache-control"]).toContain("no-store");
  await expect(
    buyer.getByRole("heading", { name: "Покупка по ссылке" }),
  ).toBeVisible();
  await expect(buyer.locator('input[name="returnTo"]')).toHaveValue(path);
  await expect(
    buyer.getByRole("button", { name: "Войти для покупки" }),
  ).toBeVisible();
  await buyer.getByText("Все условия покупки", { exact: true }).click();
  await expect(
    buyer.getByText(/Сопровождение автора — 6 месяцев/),
  ).toBeVisible();
  expect(
    (
      await new AxeBuilder({ page: buyer })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations.filter(
      (item) => item.impact === "serious" || item.impact === "critical",
    ),
  ).toEqual([]);
  expect(
    await buyer.evaluate(
      () =>
        document.documentElement.scrollWidth ===
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
  if (process.env["CAPTURE_EVIDENCE"] === "1") {
    await prepareEvidenceDirectory("issue-1450");
    await screenshotWholePage(buyer, {
      path: evidencePath("issue-1450", `private-${testInfo.project.name}.png`),
    });
  }
  await signInFullStack(guest, "NON_MEMBER");
  await buyer.reload();
  await expect(buyer.getByRole("button", { name: /Оплатить/ })).toBeVisible();
  await expect(buyer.getByRole("link", { name: /оферт/ })).toHaveAttribute(
    "href",
    /\/legal\/purchase\/v6/,
  );
  const revoked = await fullStackBrowserRequest(
    page,
    "/api/authoring/billing/payment-links/revoke",
    "POST",
    {
      input: JSON.stringify({
        operationId: randomUUID(),
        id: link.id,
        expectedRevision: link.revision,
      }),
    },
  );
  expect(await revoked.json()).toMatchObject({ ok: true });
  await buyer.reload();
  await expect(
    buyer.getByRole("heading", { name: "Ссылка отозвана" }),
  ).toBeVisible();
  await expect(buyer.getByRole("button", { name: /Оплатить/ })).toHaveCount(0);
  await guest.close();
});
