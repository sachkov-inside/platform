import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { z } from "zod";
import { fullStackBrowserRequest } from "../support/full-stack-session";

const paidBody = "Закрытое содержимое для участников.";
const paidChapter = "/materials/developer-pipeline-bez-poteri-konteksta";

/**
 * Published purchase v7 carries the lifetime Product model, so the real seeded Product Price is on
 * sale: the buyer signs in, accepts v7 by the payment button, pays on the bank double and reads the
 * protected Material.
 */
test("buyer signs in through Telegram, pays for the Product on published v7 and opens its Materials", async ({
  page,
}, info) => {
  const slug = process.env["BUYER_JOURNEY_PRODUCT_SLUG"];
  if (slug === undefined || slug.length === 0)
    throw new Error("Missing disposable buyer Product");
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`/products/${slug}`);
  await expect(
    page.getByRole("heading", { level: 1, name: "Создание Platform Inside" }),
  ).toBeVisible();
  await page.goto("/account");
  await page
    .getByRole("button", { name: "Войти через Telegram", exact: true })
    .first()
    .click();
  await expect(
    page.getByRole("heading", { name: "Тестовый провайдер входа" }),
  ).toBeVisible();
  const telegramUserId =
    info.project.name === "mobile-chromium" ? "775000002" : "775000001";
  await page.getByLabel("Telegram ID").fill(telegramUserId);
  await page.getByRole("button", { name: "Войти через Telegram" }).click();
  await page
    .locator("dialog:modal")
    .getByRole("button", { name: "Принять условия и продолжить" })
    .click({ timeout: 30000 });
  await page.waitForURL((url) => url.pathname !== "/welcome");
  const status = await fullStackBrowserRequest(page, "/auth/status");
  expect(await status.json()).toMatchObject({ state: "authenticated" });
  await page.goto("/materials/kak-ustroen-inside-platform");
  await expect(
    page
      .getByText(
        "Этот материал создаётся идемпотентным local seed через application interface.",
      )
      .first(),
  ).toBeVisible();
  await page.goto(paidChapter);
  await expect(
    page.locator('[data-material-reader-state="access-required"]').first(),
  ).toBeVisible();
  await expect(page.getByText(paidBody)).toHaveCount(0);

  const contact = await fullStackBrowserRequest(
    page,
    "/api/account/billing/contact",
  );
  const catalogue = z
    .object({
      ok: z.literal(true),
      documents: z.array(
        z.object({
          documentId: z.string(),
          version: z.string(),
          digest: z.string(),
          url: z.string(),
        }),
      ),
    })
    .parse(await contact.json());
  expect(
    catalogue.documents.find((document) => document.documentId === "purchase"),
  ).toMatchObject({
    version: "7",
    url: expect.stringContaining("/legal/purchase/v7"),
  });

  await page.goto(`/products/${slug}/buy`);
  await expect(
    page.getByText("Этот продукт сейчас не продаётся отдельно."),
  ).toHaveCount(0);
  const pay = page.getByRole("button", { name: /^Оплатить/u });
  await expect(pay).toBeEnabled();
  const checkout = page.getByRole("form", { name: "Оплата продукта" });
  await checkout
    .getByText("Условия и документы покупки", { exact: true })
    .click();
  await expect(
    checkout.getByText(/Сопровождение автора по условиям оферты/u),
  ).toBeVisible();
  // Срок сопровождения остаётся в оферте и на странице оплаты не рекламируется.
  await expect(checkout.getByText(/\b3 (календарных )?месяц/u)).toHaveCount(0);
  const cookieNotice = page.getByRole("button", {
    name: "Понятно",
    exact: true,
  });
  if (await cookieNotice.isVisible()) await cookieNotice.click();
  const email = page.getByLabel("Почта для чека");
  if ((await email.count()) > 0)
    await email.fill(`buyer-${telegramUserId}@inside.test`);
  const scan = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(
    scan.violations.filter(
      (item) => item.impact === "serious" || item.impact === "critical",
    ),
  ).toEqual([]);
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth ===
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
  await info.attach("published-v7-checkout", {
    body: await page.screenshot(),
    contentType: "image/png",
  });

  await pay.click();
  await expect(page).toHaveURL(/\/pay\/[^/]+$/u);
  await page.getByRole("button", { name: "Оплата прошла" }).click();
  await expect(page).toHaveURL(
    (url) =>
      url.pathname === `/products/${slug}/buy` &&
      url.searchParams.has("purchaseRef"),
  );
  const purchaseRef = z
    .uuid()
    .parse(new URL(page.url()).searchParams.get("purchaseRef"));
  await expect(
    page.getByRole("heading", { name: "Продукт открыт", exact: true }),
  ).toBeVisible({ timeout: 60_000 });
  const purchaseStatus = await fullStackBrowserRequest(
    page,
    `/api/account/billing/purchase-status?purchaseRef=${purchaseRef}`,
  );
  expect(await purchaseStatus.json()).toMatchObject({
    value: { purchaseRef, state: "confirmed", access: "ready" },
  });
  await expect
    .poll(
      async () => {
        await page.goto(paidChapter);
        return page.getByText(paidBody).count();
      },
      { timeout: 60_000 },
    )
    .toBeGreaterThan(0);
  await expect(
    page.locator('[data-material-reader-state="access-required"]'),
  ).toHaveCount(0);
  const billing = await fullStackBrowserRequest(page, "/api/account/billing");
  expect(await billing.json()).toMatchObject({
    ok: true,
    value: {
      payments: [expect.objectContaining({ purchaseRef, state: "confirmed" })],
    },
  });
  expect(errors).toEqual([]);
});
