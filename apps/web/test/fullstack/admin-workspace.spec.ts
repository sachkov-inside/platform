import { randomUUID } from "node:crypto";
import { ownerPriceCatalogSchema as ownerCatalogSchema } from "@/entities/subscription/model/owner-price-catalog";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import {
  fullStackBaseUrl,
  fullStackPageRequest,
  signInFullStack,
} from "../support/full-stack-session";
import { screenshotWholePage } from "../support/whole-page-screenshot.mjs";

test("admin workspace exposes every active task on desktop and phone through real routes", async ({
  page,
  context,
}, info) => {
  await signInFullStack(context, "OWNER");
  await page.goto("/authoring");
  await expect(page).toHaveURL(/\/authoring\/products$/u);
  const phone = (page.viewportSize()?.width ?? 1440) < 1024;
  // На телефоне «Люди», «Продажи» и «Сдачи» стоят в нижней панели, остальное открывает «Ещё».
  const destinations = [
    ["Материалы", "/authoring/materials", "more"],
    ["Темы", "/authoring/topics", "more"],
    ["Сдачи", "/authoring/submissions", "dock"],
    ["Люди", "/authoring/access", "dock"],
    [phone ? "Продажи" : "Платежи", "/authoring/sales/payments", "dock"],
    ["Воронка продаж", "/authoring/sales/funnel", "more"],
    ["Продукты", "/authoring/products", "more"],
  ] as const;
  for (const [label, pathname, place] of destinations) {
    const more = page.getByRole("button", { name: "Ещё", exact: true });
    if (phone && place === "more") await more.click();
    const navigation = page.getByRole("navigation", {
      name: phone
        ? place === "more"
          ? "Другие разделы"
          : "Основные разделы"
        : "Разделы админки",
      exact: true,
    });
    const link = navigation.getByRole("link", {
      name: new RegExp(`^${label}(?:, без комментария: \\d+)?$`, "u"),
    });
    await expect(link).toBeVisible();
    await link.click();
    await expect(page).toHaveURL(new RegExp(`${pathname}(?:\\?.*)?$`, "u"));
    await expect(page.locator("[data-authoring-shell]")).toHaveCount(1);
    await expect(page.getByRole("main")).toHaveCount(1);
    await expect(
      page.getByRole("main").getByRole("heading", { level: 1 }),
    ).toBeVisible();
    if (phone) {
      await expect(more).toHaveAttribute("aria-expanded", "false");
      await expect(page.getByRole("dialog", { name: "Ещё" })).toHaveCount(0);
    }
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      ),
    ).toBe(true);
    const accessibility = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(accessibility.violations).toEqual([]);
    if (process.env["CAPTURE_EVIDENCE"] === "1") {
      await screenshotWholePage(page, {
        path: info.outputPath(`${pathname.split("/").at(-1) ?? "admin"}.png`),
      });
    }
  }
});

test("owner creates a price and edits it twice without stale catalogue revisions", async ({
  page,
  context,
}) => {
  await signInFullStack(context, "OWNER");
  const productId = randomUUID();
  const name = `Цена synthetic ${productId}`;
  await page.goto("/authoring/products");
  await page.getByRole("button", { name: "Создать продукт" }).click();
  await page.getByRole("textbox", { name: "Название", exact: true }).fill(name);
  await page
    .getByRole("textbox", { name: "Адрес", exact: false })
    .fill(`price-${productId}`);
  await page.getByRole("button", { name: "Создать", exact: true }).click();
  await expect(page).toHaveURL(/\/authoring\/products\/[^/]+$/u);
  const createdId = page.url().split("/").at(-1);
  if (createdId === undefined)
    throw new Error("Created Product has no URL identifier");
  // Вкладка «Продажа»: каждая запись цены перечитывает каталог цен для блока ссылок на оплату.
  const catalogRead = () =>
    page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/authoring/billing/catalog") &&
        response.request().method() === "GET",
    );
  const firstRead = catalogRead();
  await page.goto(`/authoring/products/${createdId}?tab=sale`);
  expect((await firstRead).status()).toBe(200);
  const panel = page.getByRole("tabpanel", { name: "Продажа" });
  for (const [index, rubles] of [120, 130, 140].entries()) {
    await panel.getByRole("textbox", { name: "Цена, ₽" }).fill(String(rubles));
    const refreshed = catalogRead();
    await panel.getByRole("button", { name: "Сохранить цену" }).click();
    const response = await refreshed;
    expect(response.status()).toBe(200);
    const envelope: unknown = await response.json();
    const result = ownerCatalogSchema.parse(
      typeof envelope === "object" && envelope !== null && "value" in envelope
        ? envelope.value
        : undefined,
    );
    expect(
      result.items.find((item) => item.product?.id === createdId),
    ).toMatchObject({
      product: { id: createdId, priceRevision: index + 1 },
      paymentOption: { priceKopecks: rubles * 100, mode: "one_time" },
      offer: { published: false },
    });
    // Сообщение продажи стоит первым: у блока ссылок ниже своя строка состояния фильтров.
    await expect(panel.getByRole("status").first()).toHaveText(
      "Цена сохранена.",
    );
  }
});

test("owner catalogue GET keeps private headers for guest, non-owner and owner", async ({
  page,
  context,
  browser,
}) => {
  const path = "/api/authoring/billing/catalog";
  const guest = await browser.newContext();
  try {
    const response = await guest.request.get(`${fullStackBaseUrl()}${path}`);
    expect(response.status()).toBe(401);
    expect(response.headers()["cache-control"]).toContain("no-store");
    expect(response.headers()["cache-control"]).toContain("private");
    expect(response.headers()["vary"]?.toLowerCase()).toContain("cookie");
  } finally {
    await guest.close();
  }
  for (const [role, status] of [
    ["OWNER", 200],
    ["MEMBER", 403],
    ["MATERIALS_ONLY", 403],
  ] as const) {
    await signInFullStack(context, role);
    await page.goto("/");
    const request = await fullStackPageRequest(page);
    try {
      const response = await request.get(path);
      expect(response.status()).toBe(status);
      expect(response.headers()["cache-control"]).toContain("no-store");
      expect(response.headers()["cache-control"]).toContain("private");
      expect(response.headers()["vary"]?.toLowerCase()).toContain("cookie");
      if (status === 200) {
        const body: unknown = await response.json();
        expect(
          typeof body === "object" &&
            body !== null &&
            "value" in body &&
            ownerCatalogSchema.safeParse(body.value).success,
        ).toBe(true);
      } else {
        expect(await response.json()).toMatchObject({
          ok: false,
          code: "forbidden",
        });
      }
    } finally {
      await request.dispose();
    }
  }
});
