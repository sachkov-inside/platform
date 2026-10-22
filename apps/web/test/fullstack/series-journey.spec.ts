import { randomUUID } from "node:crypto";
import { z } from "zod";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator } from "@playwright/test";
import { resolve } from "node:path";

import {
  fullStackBrowserJsonRequest,
  fullStackBrowserRequest,
  signInFullStack,
} from "../support/full-stack-session";
import {
  evidenceDirectory,
  prepareEvidenceDirectory,
} from "../../../../scripts/evidence-path.mjs";
import {
  expectLinearProgrammeReturn,
  expectProgrammeReturnTarget,
} from "../support/linear-programme";
import { screenshotWholePage } from "../support/whole-page-screenshot.mjs";

// Руководство разделено на продукт, программу и оплату (#509). Место чтения возвращает карточка
// материала в программе и `at=` в адресе; шапка показывает личный прогресс.
const snapshots = evidenceDirectory("issue-529");

async function expectNoGlobalProgrammeContinue(programme: Locator) {
  await expect(programme).toHaveCount(1);
  await expect(programme).toBeVisible();
  const header = programme.locator('[data-programme-part="header"]');
  await expect(header).toHaveCount(1);
  await expect(header).toBeVisible();
  await expect(
    header.getByRole("link", { name: "Продолжить", exact: true }),
  ).toHaveCount(0);
  await expect(
    programme
      .getByRole("link", { name: "Продолжить", exact: true })
      .and(programme.locator("a:not([data-series-continuation])")),
  ).toHaveCount(0);
  return header;
}

test("product product leads to the programme and the programme keeps the Reader return position", async ({
  page,
  context,
}, testInfo) => {
  await signInFullStack(context, "NON_MEMBER");
  await page.addLocatorHandler(
    page.getByRole("button", { name: "Закрыть подключение Telegram" }),
    async (button) => {
      await button.click();
    },
  );

  // Страница продукта рассказывает о руководстве и ведёт в программу одним действием.
  await page.goto("/products/demo-series-harness");
  await expect(
    page.locator('[data-product-landing="demo-series-harness"]:visible'),
  ).toBeVisible();
  await expect(page.getByRole("progressbar")).toHaveCount(0);
  await page
    .getByRole("link", { name: "Открыть программу", exact: true })
    .click();
  await expect(page).toHaveURL(/\/products\/demo-series-harness\/programme/u);

  // Личный прогресс находится в шапке, продолжение — на карточке материала.
  const programme = page.locator(
    '[data-product-programme="demo-series-harness"]:visible',
  );
  const header = await expectNoGlobalProgrammeContinue(programme);
  await expect(
    header.getByRole("progressbar", { name: "Прогресс продукта" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Показать в маршруте" }),
  ).toHaveCount(0);

  // Возврат из читалки приводит на ту же страницу программы и подсвечивает строку материала.
  const finalRow = programme.locator(
    '[data-route-material="demo-295-finalnyy-gayd"]',
  );
  await expect(finalRow).toHaveCount(1);
  await expect(finalRow).toHaveAttribute("data-series-ordinal", "2");
  const opened = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/reading-progress/open" &&
      response.request().method() === "POST",
  );
  await finalRow
    .getByRole("link", { name: "Demo #295 · Финальный гайд", exact: true })
    .click();
  await expect(page.locator("[data-reader-body]:visible")).toBeVisible();
  expect((await opened).status()).toBe(200);
  const programmeReturnHref = expectProgrammeReturnTarget(
    new URL(page.url()).searchParams.get("from"),
    "/products/demo-series-harness/programme?page=1&at=demo-295-finalnyy-gayd",
  );
  const programmeReturn = await expectLinearProgrammeReturn(
    page,
    testInfo.project.name === "mobile-chromium",
    programmeReturnHref,
  );
  await programmeReturn.click();
  await expect(page).toHaveURL(/at=demo-295-finalnyy-gayd/u);
  await expect(page).toHaveURL(new URL(programmeReturnHref, page.url()).href);
  await expect(finalRow).toBeInViewport();
  await page.reload();
  await expectNoGlobalProgrammeContinue(programme);
  await expect(finalRow).toHaveCount(1);
  await expect(finalRow).toHaveAttribute("data-series-ordinal", "2");
  await expect(finalRow).toBeInViewport();
  // Продолжение подтверждает открытие в этом сценарии, независимо от прежних посещений аккаунта.
  const continuation = finalRow.getByRole("link", {
    name: "Продолжить",
    exact: true,
  });
  await expect(
    programme.getByRole("link", { name: "Продолжить", exact: true }),
  ).toHaveCount(1);
  await expect(continuation).toHaveCount(1);
  await expect(continuation).toBeVisible();
  await expect(continuation).toHaveAttribute(
    "data-series-continuation",
    "true",
  );
  const placementId = new URL(programmeReturnHref, page.url()).searchParams.get(
    "atPlacement",
  );
  if (placementId === null) throw new Error("Missing programme placement");
  const continuationHref = `/materials/demo-295-finalnyy-gayd?from=${encodeURIComponent(programmeReturnHref)}&placement=${placementId}`;
  await expect(continuation).toHaveAttribute("href", continuationHref);
  const continuationUrl = new URL(
    (await continuation.getAttribute("href")) ?? "",
    page.url(),
  );
  expect(continuationUrl.pathname).toBe("/materials/demo-295-finalnyy-gayd");
  expect(continuationUrl.searchParams.get("from")).toBe(programmeReturnHref);
  await expect(
    page.getByRole("navigation", { name: "Страницы маршрута" }),
  ).toHaveCount(0);
  const accessibility = await new AxeBuilder({ page })
    .include('[data-product-programme="demo-series-harness"]')
    .analyze();
  expect(accessibility.violations).toEqual([]);
  await prepareEvidenceDirectory("issue-529");
  await page.evaluate(() => {
    window.scrollTo(0, 0);
  });
  await screenshotWholePage(page, {
    path: resolve(snapshots, `programme-${testInfo.project.name}.png`),
  });

  // Гость видит состав и замки, но не получает ни прогресса, ни обещания чужого продолжения.
  await context.clearCookies();
  await page.goto("/products/platform-inside/programme");
  await expect(
    page.getByRole("main").getByText("Нужен доступ", { exact: true }).first(),
  ).toBeVisible();
  await expect(page.getByRole("progressbar")).toHaveCount(0);
  await expect(page.locator('[aria-current="step"]')).toHaveCount(0);
  await screenshotWholePage(page, {
    path: resolve(snapshots, `programme-guest-${testInfo.project.name}.png`),
  });
});

test("product programme marks the last opened material as the place to continue", async ({
  page,
  context,
}) => {
  await signInFullStack(context, "NON_MEMBER");
  await page.addLocatorHandler(
    page.getByRole("button", { name: "Закрыть подключение Telegram" }),
    async (button) => {
      await button.click();
    },
  );
  for (const slug of ["demo-295-obshchiy-gayd", "demo-295-finalnyy-gayd"]) {
    const opened = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/reading-progress/open") &&
        response.request().method() === "POST",
    );
    await page.goto(`/materials/${slug}`);
    expect((await opened).ok()).toBe(true);
    const button = page
      .getByRole("navigation", { name: "Действия материала", exact: true })
      .getByRole("button", { name: "Изучено", exact: true });
    const lowerButton = page
      .getByRole("navigation", {
        name: "Действия в конце материала",
        exact: true,
      })
      .getByRole("button", { name: "Изучено", exact: true });
    await expect(button).toHaveCount(1);
    await expect(lowerButton).toHaveCount(1);
    await expect(button).toBeVisible();
    await expect(lowerButton).toBeVisible();
    await expect(button).toBeEnabled();
    await expect(lowerButton).toBeEnabled();
    if ((await button.getAttribute("aria-pressed")) === "true") {
      await expect(lowerButton).toHaveAttribute("aria-pressed", "true");
      await button.click();
    }
    for (const action of [button, lowerButton]) {
      await expect(action).toHaveAttribute("aria-pressed", "false");
      await expect(action).toBeEnabled();
    }
  }

  await page.goto("/products/demo-series-harness/programme");
  const current = page.locator('[aria-current="step"]:visible');
  // Место возврата обозначено выделением строки, а не словами: подпись убрал #441 вместе с
  // прочими лишними статусами маршрута, и это решение о внешнем виде остаётся в силе.
  await expect(current).toHaveAttribute(
    "data-route-material",
    "demo-295-finalnyy-gayd",
  );
});

test("product programme appends a real composition and restores Reader return position", async ({
  page,
  context,
  request,
}, testInfo) => {
  await signInFullStack(context, "OWNER");
  await page.addLocatorHandler(
    page.getByRole("button", { name: "Закрыть подключение Telegram" }),
    async (button) => {
      await button.click();
    },
  );
  await page.goto("/account");
  const slug = `series-journey-${randomUUID()}`;
  const created = await fullStackBrowserJsonRequest(
    page,
    "/api/authoring/collections",
    "POST",
    {
      kind: "series",
      name: "Demo #426 · Длинный маршрут",
      slug,
      summary: "Локальная проверка прохождения продукта.",
    },
  );
  expect(created.ok()).toBe(true);
  const { collection } = z
    .object({
      kind: z.literal("saved"),
      collection: z.object({ id: z.uuid(), version: z.number() }),
    })
    .parse(await created.json());
  try {
    // Список не показывает источник. Запускатор передаёт все импортированные Material IDs,
    // включая урок и страницы заданий формата c: продукт Platform не принимает такой состав.
    const importedIds = process.env["FULLSTACK_IMPORTED_MATERIAL_IDS"];
    if (importedIds === undefined)
      throw new Error("Missing isolated imported Material fixtures");
    const importedMaterialIds = new Set(importedIds.split(","));
    const ids: string[] = [];
    for (let number = 1; number <= 3 && ids.length < 13; number++) {
      const response = await fullStackBrowserRequest(
        page,
        `/api/authoring/materials?page=${String(number)}&search=`,
      );
      const data = z
        .object({
          kind: z.literal("ready"),
          items: z.array(
            z.object({ materialId: z.uuid(), publicationState: z.string() }),
          ),
        })
        .parse(await response.json());
      ids.push(
        ...data.items
          .filter(
            (item) =>
              item.publicationState === "published" &&
              !importedMaterialIds.has(item.materialId),
          )
          .map((item) => item.materialId),
      );
    }
    expect(ids.length).toBeGreaterThanOrEqual(13);
    const orderResponse = await fullStackBrowserRequest(
      page,
      `/api/authoring/series/${collection.id}/order`,
    );
    const { order } = z
      .object({
        kind: z.literal("ready"),
        order: z.object({ orderVersion: z.string() }),
      })
      .parse(await orderResponse.json());
    // Материал практики перенесён из источника: продукт из редактора его не принимает, и отказ
    // называет именно его, а не завершившуюся сессию (#841).
    const [importedPracticeId] = importedMaterialIds;
    const refused = await fullStackBrowserJsonRequest(
      page,
      "/api/authoring/series/order",
      "PUT",
      {
        seriesId: collection.id,
        expectedOrderVersion: order.orderVersion,
        orderedMaterialIds: [ids[0], importedPracticeId],
      },
    );
    expect(await refused.json()).toEqual({
      kind: "source_mismatch",
      materialIds: [importedPracticeId],
    });
    const saved = await fullStackBrowserJsonRequest(
      page,
      "/api/authoring/series/order",
      "PUT",
      {
        seriesId: collection.id,
        expectedOrderVersion: order.orderVersion,
        orderedMaterialIds: ids.slice(0, 13),
      },
    );
    expect(await saved.json()).toMatchObject({ kind: "saved" });
    await page.goto(`/products/${slug}/programme?page=1`);
    // `load` наступает, пока на экране программа на общих данных; личная часть заменяет её дерево
    // позже (ADR 0027). Прокрутка находит кнопку один раз и после замены держит оторванный узел
    // (#993), поэтому сначала ждём личную часть: «всё открыто» пишет только она.
    await expect(
      page.getByText("13 материалов · всё открыто").filter({ visible: true }),
    ).toBeVisible();
    // Early reveal can already append row 13 and remove the fallback button. Row 12 remains
    // mounted in either state, so approaching it must reveal the rest without clicking a button.
    const loadedBoundary = page.locator('[data-series-ordinal="12"]:visible');
    await loadedBoundary.scrollIntoViewIfNeeded();
    await expect(page.locator("[data-series-ordinal]:visible")).toHaveCount(13);
    await expect(
      page.getByRole("navigation", { name: "Страницы маршрута" }),
    ).toHaveCount(0);
    const row = page.locator('[data-series-ordinal="13"]:visible');
    const materialSlug = await row.getAttribute("data-route-material");
    expect(materialSlug).not.toBeNull();
    await row.getByRole("heading").getByRole("link").click();
    await expect(page.locator("[data-reader-body]:visible")).toBeVisible();
    const programmeReturnHref = expectProgrammeReturnTarget(
      new URL(page.url()).searchParams.get("from"),
      `/products/${slug}/programme?page=2&at=${String(materialSlug)}`,
    );
    const programmeReturn = await expectLinearProgrammeReturn(
      page,
      testInfo.project.name === "mobile-chromium",
      programmeReturnHref,
    );
    await programmeReturn.click();
    await expect(page).toHaveURL(/page=2&at=/u);
    await expect(page).toHaveURL(new URL(programmeReturnHref, page.url()).href);
    await expect(row).toBeInViewport();
    await page.reload();
    await expect(row).toBeInViewport();
    await expect(page.locator("[data-series-ordinal]:visible")).toHaveCount(13);
    await expect(
      page.locator("p:visible", { hasText: "Показано 13 из 13 материалов" }),
    ).toHaveCount(0);
    await row.getByRole("heading").getByRole("link").click();
    await expect(page.locator("[data-reader-body]:visible")).toBeVisible();
    await page.goBack();
    await expect(row).toBeInViewport();
    await expect(page.locator("[data-series-ordinal]:visible")).toHaveCount(13);
    // Возврат загружает документ заново. Пока личная часть в пути, на экране программа на общих
    // данных (ADR 0027); личная часть сменяет её своим деревом, и выбранная там вкладка пропадает.
    // «Всё открыто» пишет только личная часть.
    await expect(
      page.getByText("13 материалов · всё открыто").filter({ visible: true }),
    ).toBeVisible();
    const sections = page.getByRole("navigation", { name: "Разделы продукта" });
    await sections.getByRole("button", { name: /^Материалы/u }).click();
    await sections.getByRole("button", { name: /^Программа/u }).click();
    await loadedBoundary.scrollIntoViewIfNeeded();
    await expect(page.locator("[data-series-ordinal]:visible")).toHaveCount(13);
    await prepareEvidenceDirectory("issue-529");
    await screenshotWholePage(page, {
      path: resolve(
        snapshots,
        `programme-continuous-${testInfo.project.name}.png`,
      ),
    });
  } finally {
    // The route borrows published seed Materials. Detach them before archiving the temporary product,
    // otherwise its archive can hide a standalone Material from the next viewport's guest Reader.
    const orderResponse = await fullStackBrowserRequest(
      page,
      `/api/authoring/series/${collection.id}/order`,
    );
    const { order } = z
      .object({
        kind: z.literal("ready"),
        order: z.object({ orderVersion: z.string() }),
      })
      .parse(await orderResponse.json());
    const cleared = await fullStackBrowserJsonRequest(
      page,
      "/api/authoring/series/order",
      "PUT",
      {
        seriesId: collection.id,
        expectedOrderVersion: order.orderVersion,
        orderedMaterialIds: [],
        confirmedProductRemovals: [collection.id],
      },
    );
    expect(await cleared.json()).toMatchObject({ kind: "saved" });
    const archived = await fullStackBrowserJsonRequest(
      page,
      "/api/authoring/collections/archive",
      "PUT",
      {
        kind: "series",
        collectionId: collection.id,
        expectedVersion: collection.version,
        archived: true,
      },
    );
    expect(await archived.json()).toMatchObject({ kind: "saved" });
  }
  const apiBaseUrl =
    process.env["FULLSTACK_API_BASE_URL"] ?? "http://127.0.0.1:3001";
  const standalone = await request.get(
    `${apiBaseUrl}/materials/demo-295-samostoyatelnaya-zametka`,
  );
  expect(standalone.status()).toBe(200);
  expect(await standalone.json()).toMatchObject({
    kind: "available",
    projection: { slug: "demo-295-samostoyatelnaya-zametka" },
  });
});
