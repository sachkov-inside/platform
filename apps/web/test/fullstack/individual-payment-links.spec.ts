import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { z } from "zod";
import {
  fullStackBrowserJsonRequest,
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
  await page.getByRole("tab", { name: "Личные ссылки", exact: true }).click();
  const fixture = z
    .record(
      z.string(),
      z.object({
        productId: z.uuid(),
        linkId: z.uuid(),
        revision: z.int().positive(),
      }),
    )
    .parse(
      JSON.parse(process.env["FULLSTACK_PAYMENT_LINKS_FIXTURE"] ?? "null"),
    )[testInfo.project.name];
  if (fixture === undefined)
    throw new Error("Missing saved payment-link fixture for browser profile");
  const product = { id: fixture.productId };
  const link = { id: fixture.linkId, revision: fixture.revision };
  // Current published v6 does not authorize a new Product link. Existing immutable links still read and revoke.
  const refused = await fullStackBrowserJsonRequest(
    page,
    "/api/authoring/billing/payment-links/create",
    "POST",
    {
      operationId: randomUUID(),
      productId: product.id,
      priceRevision: 1,
      price: { kind: "discount", percent: 10 },
      expiresAt: null,
    },
  );
  expect(refused.status()).toBe(200);
  expect(await refused.json()).toMatchObject({
    ok: false,
    code: "method_unavailable",
  });
  await page.reload();
  await page.getByRole("tab", { name: "Личные ссылки", exact: true }).click();
  await expect(
    page.getByText("26 100", { exact: false }).first(),
  ).toBeVisible();
  const ownerRegion = page.getByRole("region", {
    name: "Ссылки на оплату",
    exact: true,
  });
  await ownerRegion
    .getByLabel("Продукт", { exact: true })
    .selectOption(product.id);
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
      buyer.getByText(/Сопровождение автора.*3 месяца/),
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
    await expect(
      buyer.getByRole("button", { name: /Оплатить/ }),
    ).toBeDisabled();
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
      .getByRole("tab", { name: "Личные ссылки", exact: true })
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
