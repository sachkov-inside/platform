import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { z } from "zod";
import { fullStackBrowserRequest } from "../support/full-stack-session";

/** Current published v6 remains immutable. It cannot authorize the new lifetime Product sale. */
test("buyer signs in through Telegram and sees honest unavailable sales until approved Product terms exist", async ({
  page,
}, info) => {
  const slug = process.env["BUYER_JOURNEY_PRODUCT_SLUG"];
  if (slug === undefined || slug.length === 0)
    throw new Error("Missing disposable buyer Product");
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const commerceWrites: string[] = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (
      request.method() === "POST" &&
      /\/billing\/(?:purchase|quote|consents|contact\/start|contact\/confirm)$/u.test(
        path,
      )
    )
      commerceWrites.push(path);
  });
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
  await page
    .getByLabel("Telegram ID")
    .fill(info.project.name === "mobile-chromium" ? "775000002" : "775000001");
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
  await page.goto("/materials/developer-pipeline-bez-poteri-konteksta");
  await expect(
    page.locator('[data-material-reader-state="access-required"]').first(),
  ).toBeVisible();
  await expect(
    page.getByText("Закрытое содержимое для участников."),
  ).toHaveCount(0);
  await page.goto(`/products/${slug}/buy`);
  await expect(
    page.getByText("Этот продукт сейчас не продаётся отдельно."),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /^Оплатить/u })).toHaveCount(0);
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
    version: "6",
    url: expect.stringContaining("/legal/purchase/v6"),
  });
  const billing = await fullStackBrowserRequest(page, "/api/account/billing");
  expect(await billing.json()).toMatchObject({
    ok: true,
    value: { products: [], access: { grounds: [] }, payments: [] },
  });
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
  expect(commerceWrites).toEqual([]);
  expect(errors).toEqual([]);
  await info.attach("current-terms-sale-unavailable", {
    body: await page.screenshot(),
    contentType: "image/png",
  });
});
