import { randomUUID } from "node:crypto";
import { ownerCatalogSchema } from "@/features/billing-admin/model/admin-operations";
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
  await page.goto("/authoring/products");
  const phone = (page.viewportSize()?.width ?? 1440) < 1024;
  const destinations = [
    ["Материалы", "/authoring/materials"],
    ["Темы", "/authoring/topics"],
    ["Сдачи", "/authoring/submissions"],
    ["Люди и доступ", "/authoring/access"],
    ["Продажи и платежи", "/authoring/billing"],
    ["Воронка продаж", "/authoring/sales-funnel"],
    ["Продукты", "/authoring/products"],
  ] as const;
  for (const [label, pathname] of destinations) {
    if (phone)
      await page.getByRole("button", { name: "Меню", exact: true }).click();
    const navigation = page.getByRole("navigation", {
      name: phone ? "Редактор на мобильном" : "Редактор",
      exact: true,
    });
    const link = navigation.getByRole("link", { name: label, exact: true });
    await expect(link).toBeVisible();
    await link.click();
    await expect(page).toHaveURL(new RegExp(`${pathname}(?:\\?.*)?$`, "u"));
    await expect(page.locator("[data-authoring-shell]")).toHaveCount(1);
    await expect(page.getByRole("main")).toHaveCount(1);
    await expect(
      page.getByRole("main").getByRole("heading", { level: 1 }),
    ).toBeVisible();
    if (phone)
      await expect(
        page.getByRole("button", { name: "Меню", exact: true }),
      ).toHaveAttribute("aria-expanded", "false");
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
  await page.goto("/authoring/billing");
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
  await page.goto("/authoring/billing");
  const create = page.locator("form").filter({
    has: page.getByRole("heading", {
      name: "Добавить цену продукта",
      exact: true,
    }),
  });
  await create
    .getByLabel("Идентификатор продукта", { exact: true })
    .fill(createdId);
  await create.getByLabel("Название", { exact: true }).fill(name);
  await create.getByLabel("Цена в копейках", { exact: true }).fill("12000");
  for (const [index, price] of [12000, 13000, 14000].entries()) {
    const form =
      index === 0
        ? create
        : page.locator("form").filter({
            has: page.getByRole("heading", { name: new RegExp(name, "u") }),
          });
    await form
      .getByLabel("Цена в копейках", { exact: true })
      .fill(String(price));
    const refreshed = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/authoring/billing/catalog") &&
        response.request().method() === "GET",
    );
    await form
      .getByRole("button", {
        name: index === 0 ? "Сохранить без открытия продаж" : "Сохранить цену",
        exact: true,
      })
      .click();
    const response = await refreshed;
    expect(response.status()).toBe(200);
    const envelope: unknown = await response.json();
    const result = ownerCatalogSchema.parse(
      typeof envelope === "object" && envelope !== null && "value" in envelope
        ? envelope.value
        : undefined,
    );
    expect(result.find((item) => item.product?.id === createdId)).toMatchObject(
      {
        product: { id: createdId, priceRevision: index + 1 },
        paymentOption: { priceKopecks: price, mode: "one_time" },
        offer: { published: false },
      },
    );
    await expect(
      page
        .locator("form")
        .filter({
          has: page.getByRole("heading", { name: new RegExp(name, "u") }),
        })
        .getByRole("button", { name: "Сохранить цену", exact: true }),
    ).toBeEnabled();
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
