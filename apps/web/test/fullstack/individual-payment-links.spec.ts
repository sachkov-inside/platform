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
test("individual payment link shows its fixed price and terms, revokes across open owner tabs and blocks payment", async ({
  page,
  context,
  browser,
}, testInfo) => {
  await signInFullStack(context, "OWNER");
  await page.addLocatorHandler(
    page.getByRole("button", { name: "Закрыть подключение Telegram" }),
    async (button) => {
      await button.click();
    },
  );
  await page.goto("/authoring/billing");
  await page
    .getByRole("tab", { name: "Ссылки на оплату", exact: true })
    .click();
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
  await page
    .getByRole("tab", { name: "Ссылки на оплату", exact: true })
    .click();
  await page
    .getByText("Архив анкетных скидок", { exact: true })
    .first()
    .click();
  const heading = page.getByRole("heading", {
    name: "Ссылки на оплату",
    exact: true,
  });
  await heading.scrollIntoViewIfNeeded();
  await expect(
    page.getByRole("heading", { name: "Архив анкетных скидок" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Выдать ссылку", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText("26 100", { exact: false }).first(),
  ).toBeVisible();
  const ownerRegion = page.getByRole("region", {
    name: "Ссылки на оплату",
    exact: true,
  });
  await ownerRegion
    .getByLabel("Продукт", { exact: true })
    .selectOption(optionId);
  expect(
    await ownerRegion.evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
  ).toBe(true);
  if (process.env["CAPTURE_EVIDENCE"] === "1") {
    await prepareEvidenceDirectory("issue-1450");
    await ownerRegion.screenshot({
      path: evidencePath("issue-1450", `owner-${testInfo.project.name}.png`),
    });
  }
  const guest = await browser.newContext({
    viewport: page.viewportSize() ?? { width: 1440, height: 1024 },
  });
  try {
    const buyer = await guest.newPage();
    await buyer.addLocatorHandler(
      buyer.getByRole("button", { name: "Закрыть подключение Telegram" }),
      async (button) => {
        await button.click();
      },
    );
    const path = `/payment/links/${link.id}`;
    const response = await buyer.goto(path);
    const storageNotice = buyer.getByRole("button", {
      name: "Понятно",
      exact: true,
    });
    if (await storageNotice.isVisible()) await storageNotice.click();
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
        path: evidencePath(
          "issue-1450",
          `private-${testInfo.project.name}.png`,
        ),
      });
    }
    await signInFullStack(guest, "NON_MEMBER");
    await buyer.reload();
    await expect(buyer.getByRole("button", { name: /Оплатить/ })).toBeVisible();
    await buyer
      .getByText("Условия и документы покупки", { exact: true })
      .click();
    await expect(buyer.getByRole("link", { name: /Оферта/ })).toHaveAttribute(
      "href",
      "/legal/purchase",
    );
    const contactResponse = await fullStackBrowserRequest(
      buyer,
      "/api/account/billing/contact",
    );
    const consentCatalog = z
      .object({
        ok: z.literal(true),
        documents: z.array(
          z.object({
            documentId: z.string(),
            version: z.string(),
            url: z.string(),
          }),
        ),
      })
      .parse(await contactResponse.json());
    expect(
      consentCatalog.documents.find(
        (document) => document.documentId === "purchase",
      ),
    ).toMatchObject({
      version: "6",
      url: expect.stringContaining("/legal/purchase/v6"),
    });
    const secondOwner = await context.newPage();
    await secondOwner.addLocatorHandler(
      secondOwner.getByRole("button", { name: "Закрыть подключение Telegram" }),
      async (button) => {
        await button.click();
      },
    );
    await secondOwner.goto("/authoring/billing");
    await secondOwner
      .getByRole("tab", { name: "Ссылки на оплату", exact: true })
      .click();
    const secondRegion = secondOwner.getByRole("region", {
      name: "Ссылки на оплату",
      exact: true,
    });
    await expect(
      secondRegion.locator(`input[value$="/${link.id}"]`),
    ).toHaveCount(1);
    const region = page.getByRole("region", {
      name: "Ссылки на оплату",
      exact: true,
    });
    const row = region
      .locator("section")
      .filter({ has: page.locator(`input[value$="/${link.id}"]`) });
    await row
      .getByRole("button", { name: "Отозвать ссылку", exact: true })
      .click();
    const secondRow = secondRegion
      .locator("section")
      .filter({ has: secondOwner.locator(`input[value$="/${link.id}"]`) });
    await expect(secondRow.getByText(/Ссылка отозвана/)).toBeVisible();
    await secondOwner.close();
    await buyer.reload();
    await expect(
      buyer.getByRole("heading", { name: "Ссылка отозвана" }),
    ).toBeVisible();
    await expect(buyer.getByRole("button", { name: /Оплатить/ })).toHaveCount(
      0,
    );
  } finally {
    await guest.close();
  }
});
