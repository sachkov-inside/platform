import AxeBuilder from "@axe-core/playwright";
import {
  expect,
  test,
  type APIRequestContext,
  type BrowserContext,
  type Locator,
  type Page,
  type TestInfo,
} from "@playwright/test";
import { z } from "zod";

const backendPort = process.env["FAKE_BACKEND_PORT"];
if (backendPort === undefined) throw new Error("FAKE_BACKEND_PORT is required");
const backend = `http://127.0.0.1:${backendPort}`;

/** Products and records of `sales-catalog-backend.mjs`. */
const aiEngineering = "98000000-0000-4000-8000-000000000001";
const architecture = "98000000-0000-4000-8000-000000000003";
const secondChapter = "98300000-0000-4000-8000-000000000002";

async function signIn(
  context: BrowserContext,
  baseURL: string | undefined,
  token = "sales-catalog-owner",
) {
  if (baseURL === undefined) throw new Error("baseURL is required");
  const { wrapSession } = await import("@logto/node");
  const session = await wrapSession(
    {
      accessToken: JSON.stringify({
        [`@${backend}`]: {
          // deterministic-test-allow wall-clock: The live Web process and Logto validate this session against their real clock; it carries no calendar-dependent domain assertion.
          expiresAt: Math.floor(Date.now() / 1_000) + 3_600,
          scope: "",
          token,
        },
      }),
      idToken: "sales-catalog.id.token",
      refreshToken: "sales-catalog-refresh-token",
    },
    "inside-navigation-logto-cookie-secret-key",
  );
  await context.addCookies([
    {
      httpOnly: true,
      name: "logto_inside-web-navigation",
      sameSite: "Lax",
      url: baseURL,
      value: session,
    },
  ]);
}

const isPhone = (info: TestInfo) => info.project.name === "mobile-chromium";

/** The visible row of a record: a table row from 40rem, a list item below. */
function row(page: Page, title: string | RegExp) {
  return page
    .getByRole("main")
    .locator("tr:visible, li.admin-list-item:visible")
    .filter({ hasText: title });
}

async function choose(scope: Page, filter: string, option: string) {
  await scope
    .getByRole("main")
    .getByRole("combobox", { name: filter, exact: true })
    .click();
  await scope.getByRole("option", { name: option, exact: true }).click();
}

/** Owner operations the fixture received, in arrival order. */
async function received(request: APIRequestContext) {
  const response = await request.get(`${backend}/__sales-catalog/requests`);
  expect(response.ok()).toBe(true);
  return z
    .object({ requests: z.array(z.record(z.string(), z.unknown())) })
    .parse(await response.json()).requests;
}

async function expectAccessibleWithoutOverflow(page: Page) {
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth ===
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
  const a11y = await new AxeBuilder({ page }).include("main").analyze();
  expect(a11y.violations).toEqual([]);
}

/**
 * Every visible control of `scope` has a touch target of at least 44 px in both directions on a
 * phone. A compact phone button keeps its visible 36 px footprint and widens the target with an
 * invisible `::after` layer (`button.module.css`), so the target is the larger of the two.
 */
async function expectTouchTargets(scope: Locator) {
  const sizes = await scope
    .locator(
      "button:visible, [role=combobox]:visible, select:visible, input:not([type=checkbox]):not([type=radio]):not([type=hidden]):visible",
    )
    .evaluateAll((elements) =>
      elements.map((element) => {
        const box = element.getBoundingClientRect();
        const layer = getComputedStyle(element, "::after");
        const extended =
          layer.content !== "none" && layer.position === "absolute";
        const height = Math.max(
          box.height,
          extended ? Number.parseFloat(layer.height) : 0,
        );
        const width = Math.max(
          box.width,
          extended ? Number.parseFloat(layer.width) : 0,
        );
        return {
          name: element.getAttribute("aria-label") ?? element.textContent,
          small: height < 44 || width < 44,
        };
      }),
    );
  expect(sizes.length).toBeGreaterThan(0);
  expect(sizes.filter((size) => size.small)).toEqual([]);
}

test.beforeEach(async ({ request }) => {
  expect(
    (
      await request.post(`${backend}/__control`, {
        data: { delayMs: 0, unavailable: false },
      })
    ).ok(),
  ).toBe(true);
  expect((await request.post(`${backend}/__sales-catalog/reset`)).ok()).toBe(
    true,
  );
});

test("создание ссылки на оплату на 390 px", async ({
  baseURL,
  context,
  page,
  request,
}, info) => {
  test.skip(!isPhone(info), "Сценарий телефона из решения 13");
  await context.grantPermissions(["clipboard-read", "clipboard-write"], {
    origin: baseURL ?? "",
  });
  await signIn(context, baseURL);
  await page.goto("/authoring/sales/links");
  await expect(
    page.getByRole("heading", { level: 1, name: "Ссылки на оплату" }),
  ).toBeVisible();
  await expect(row(page, "Агентная разработка")).toBeVisible();
  await expectAccessibleWithoutOverflow(page);
  await expectTouchTargets(page.getByRole("main"));

  await page
    .getByRole("main")
    .getByRole("button", { name: "Создать ссылку" })
    .click();
  const sheet = page.getByRole("dialog", { name: "Новая ссылка на оплату" });
  await expect(sheet).toBeVisible();
  // На телефоне это лист снизу во всю ширину экрана.
  const box = await sheet.boundingBox();
  expect(box).not.toBeNull();
  expect(Math.round(box?.width ?? 0)).toBe(390);
  expect(Math.round((box?.y ?? 0) + (box?.height ?? 0))).toBe(844);

  await sheet.getByLabel("Поиск: Продукт").fill("AI");
  await sheet
    .getByLabel("Продукт", { exact: true })
    .selectOption(aiEngineering);
  await sheet.getByRole("radio", { name: "Скидка, %" }).check();
  await sheet.getByRole("textbox", { name: "Скидка, %" }).fill("15");
  await sheet.getByLabel("Действует по").fill("2099-12-31");
  const preview = sheet.getByRole("region", { name: "Итог по ссылке" });
  await expect(preview).toContainText(/25\s415\s₽/u);
  await expect(preview).toContainText(/29\s900\s₽/u);
  await expect(preview).toContainText("Действует по 31 дек. 2099 включительно");
  await expectTouchTargets(sheet);
  await sheet.getByRole("button", { name: "Создать ссылку" }).click();

  const createdSheet = page.getByRole("dialog", { name: "Ссылка создана" });
  await expect(createdSheet).toBeVisible();
  const address = createdSheet.getByLabel("Ссылка для покупателя");
  await expect(address).toHaveValue(
    /\/payment\/links\/98100000-0000-4000-8000-000000000901$/u,
  );
  await createdSheet
    .getByRole("button", { name: "Скопировать ссылку" })
    .click();
  await expect(createdSheet.getByRole("status")).toHaveText(
    "Ссылка скопирована.",
  );
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    await address.inputValue(),
  );
  await expectTouchTargets(createdSheet);
  expect(
    (await received(request)).filter(
      (body) => body["operation"] === "paymentLinks.create",
    ),
  ).toEqual([
    expect.objectContaining({
      productId: aiEngineering,
      priceRevision: 3,
      price: { kind: "discount", percent: 15 },
      expiresAt: "2100-01-01T00:00:00+03:00",
    }),
  ]);

  await createdSheet.getByRole("button", { name: "Готово" }).click();
  await expect(createdSheet).toBeHidden();
  const first = page
    .getByRole("list", { name: "Ссылки на оплату, новые сверху" })
    .locator("li.admin-list-item")
    .first();
  await expect(first).toContainText("AI Engineering");
  await expect(first).toContainText("по 31 дек. 2099");
  await expectAccessibleWithoutOverflow(page);
});

test("ссылка на оплату суммой в диалоге на 1440 px", async ({
  baseURL,
  context,
  page,
  request,
}, info) => {
  test.skip(isPhone(info), "Вариант широкого экрана");
  await signIn(context, baseURL);
  await page.goto("/authoring/sales/links");
  await page
    .getByRole("main")
    .getByRole("button", { name: "Создать ссылку" })
    .click();
  const dialog = page.getByRole("dialog", { name: "Новая ссылка на оплату" });
  const box = await dialog.boundingBox();
  // На компьютере это диалог по центру, а не лист во всю ширину.
  expect(box?.width ?? 0).toBeLessThan(600);
  await dialog
    .getByLabel("Продукт", { exact: true })
    .selectOption(architecture);
  await dialog.getByRole("radio", { name: "Сумма, ₽" }).check();
  await dialog.getByLabel("Сумма к оплате, ₽").fill("35 000");
  await expect(
    dialog.getByRole("region", { name: "Итог по ссылке" }),
  ).toContainText(/35\s000\s₽/u);
  await dialog.getByRole("button", { name: "Создать ссылку" }).click();
  await expect(
    page.getByRole("dialog", { name: "Ссылка создана" }),
  ).toBeVisible();
  expect(
    (await received(request)).filter(
      (body) => body["operation"] === "paymentLinks.create",
    ),
  ).toEqual([
    expect.objectContaining({
      productId: architecture,
      price: { kind: "amount", amountKopecks: 3_500_000 },
      expiresAt: null,
    }),
  ]);
  await expectAccessibleWithoutOverflow(page);
});

test("фильтры ссылок живут в адресе, а отзыв идёт с редакцией и подтверждением", async ({
  baseURL,
  context,
  page,
  request,
}, info) => {
  await signIn(context, baseURL);
  await page.goto("/authoring/sales/links");
  await expect(row(page, "Агентная разработка")).toBeVisible();

  await choose(page, "Состояние", "Отозвана");
  await expect(page).toHaveURL("/authoring/sales/links?state=revoked");
  await expect(row(page, "Агентная разработка")).toHaveCount(0);
  await choose(page, "Продукт", "Архитектура систем");
  await expect(page).toHaveURL(
    `/authoring/sales/links?product=${architecture}&state=revoked`,
  );
  await expect(row(page, "Архитектура систем").first()).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL("/authoring/sales/links?state=revoked");
  await page.goBack();
  await expect(page).toHaveURL("/authoring/sales/links");
  await expect(row(page, "Агентная разработка")).toBeVisible();

  await page
    .getByRole("main")
    .getByRole("button", {
      name: "Действия со ссылкой «AI Engineering» от 26 окт. 2026",
    })
    .click();
  await page.getByRole("menuitem", { name: "Отозвать" }).click();
  const confirm = page.getByRole("dialog", {
    name: "Отозвать ссылку на «AI Engineering»?",
  });
  await expect(confirm).toBeVisible();
  // Опасное действие начинается с безопасной кнопки.
  await expect(confirm.getByRole("button", { name: "Отмена" })).toBeFocused();
  if (isPhone(info)) await expectTouchTargets(confirm);
  await confirm.getByRole("button", { name: "Отозвать ссылку" }).click();
  await expect(confirm).toBeHidden();
  await expect(
    page.getByText("Ссылка отозвана. Оплатить по ней больше нельзя."),
  ).toBeVisible();
  await expect(row(page, "AI Engineering").first()).toContainText("Отозвана");
  expect(
    (await received(request)).filter(
      (body) => body["operation"] === "paymentLinks.revoke",
    ),
  ).toEqual([
    expect.objectContaining({
      id: "98100000-0000-4000-8000-000000000001",
      expectedRevision: 1,
    }),
  ]);
  await expectAccessibleWithoutOverflow(page);
});

test("скидки: создание, изменение и архив без ввода UUID", async ({
  baseURL,
  context,
  page,
  request,
}, info) => {
  await signIn(context, baseURL);
  await page.goto("/authoring/sales/discounts");
  await expect(
    page.getByRole("heading", { level: 1, name: "Скидки" }),
  ).toBeVisible();
  await expect(row(page, "Осенняя скидка на AI Engineering")).toContainText(
    "Агентная разработка",
  );
  await expect(row(page, "Скидка выпускникам")).toContainText("Все продукты");
  await expectAccessibleWithoutOverflow(page);
  if (isPhone(info)) await expectTouchTargets(page.getByRole("main"));

  await page
    .getByRole("main")
    .getByRole("button", { name: "Создать скидку" })
    .click();
  const form = page.getByRole("dialog", { name: "Новая скидка" });
  await form.getByLabel("Название").fill("Чёрная пятница");
  await form.getByLabel("Скидка, %").fill("30");
  await form.getByLabel("Промокод").fill("BLACK");
  await form.getByLabel("Поиск: Продукты").fill("Архит");
  await form.getByRole("checkbox", { name: /Архитектура систем/u }).check();
  await expect(
    form.getByRole("list", { name: "Выбрано: Продукты" }),
  ).toContainText("Архитектура систем");
  await form.getByLabel("Первый день").fill("2026-11-27");
  await form.getByLabel("Последний день").fill("2026-11-30");
  if (isPhone(info)) await expectTouchTargets(form);
  await form.getByRole("button", { name: "Создать скидку" }).click();
  await expect(form).toBeHidden();
  await expect(
    page.getByText("Скидка «Чёрная пятница» создана."),
  ).toBeVisible();
  await expect(row(page, "Чёрная пятница")).toContainText("Архитектура систем");

  await page
    .getByRole("main")
    .getByRole("button", { name: "Действия со скидкой «Скидка выпускникам»" })
    .click();
  await page.getByRole("menuitem", { name: "Изменить" }).click();
  const edit = page.getByRole("dialog", { name: "Изменить скидку" });
  await expect(edit.getByLabel("Скидка, %")).toHaveValue("10");
  await edit.getByLabel("Скидка, %").fill("15");
  await edit.getByRole("button", { name: "Сохранить изменения" }).click();
  await expect(edit).toBeHidden();
  await expect(row(page, "Скидка выпускникам")).toContainText("15 %");

  await page
    .getByRole("main")
    .getByRole("button", {
      name: "Действия со скидкой «Осенняя скидка на AI Engineering»",
    })
    .click();
  await page.getByRole("menuitem", { name: "Архивировать" }).click();
  const confirm = page.getByRole("dialog", {
    name: "Архивировать «Осенняя скидка на AI Engineering»?",
  });
  await confirm.getByRole("button", { name: "Архивировать скидку" }).click();
  await expect(confirm).toBeHidden();
  await expect(row(page, "Осенняя скидка на AI Engineering")).toHaveCount(0);

  const writes = (await received(request)).filter((body) =>
    ["promotions.save", "promotions.archive"].includes(
      String(body["operation"]),
    ),
  );
  expect(writes).toEqual([
    expect.objectContaining({
      operation: "promotions.save",
      value: expect.objectContaining({
        name: "Чёрная пятница",
        percent: 30,
        code: "BLACK",
        productIds: [architecture],
        startsAt: "2026-11-27T00:00:00+03:00",
        endsAt: "2026-12-01T00:00:00+03:00",
        usageLimit: null,
      }),
    }),
    expect.objectContaining({
      operation: "promotions.save",
      expectedRevision: 1,
      value: expect.objectContaining({
        id: "98200000-0000-4000-8000-000000000002",
        percent: 15,
        productIds: [],
        startsAt: "2026-09-01T00:00:00+03:00",
      }),
    }),
    expect.objectContaining({
      operation: "promotions.archive",
      id: "98200000-0000-4000-8000-000000000001",
      expectedRevision: 3,
    }),
  ]);
  expect(writes[0]).not.toHaveProperty("expectedRevision");
});

test("архив скидок и анкетные скидки открываются по адресу и «назад»", async ({
  baseURL,
  context,
  page,
}) => {
  await signIn(context, baseURL);
  await page.goto("/authoring/sales/discounts");
  await expect(row(page, "Скидка выпускникам")).toBeVisible();

  await choose(page, "Записи", "Архив");
  await expect(page).toHaveURL("/authoring/sales/discounts?archived=1");
  const legacy = row(page, "Скидка подписчикам Tribute");
  await expect(legacy).toContainText("Прежние предложения");
  await expect(legacy).not.toContainText("Все продукты");
  await page
    .getByRole("main")
    .getByRole("button", {
      name: "Действия со скидкой «Скидка подписчикам Tribute»",
    })
    .click();
  await expect(page.getByRole("menuitem", { name: "Изменить" })).toBeDisabled();
  await page.keyboard.press("Escape");

  await page
    .getByRole("navigation", { name: "Подразделы скидок" })
    .getByRole("button", { name: "Анкетные скидки" })
    .click();
  await expect(page).toHaveURL("/authoring/sales/discounts?view=questionnaire");
  await expect(row(page, "anna_dev")).toContainText("Оплачена");
  await expect(
    page.getByRole("main").getByRole("button", { name: "Создать скидку" }),
  ).toHaveCount(0);
  await expectAccessibleWithoutOverflow(page);

  await page.goBack();
  await expect(page).toHaveURL("/authoring/sales/discounts?archived=1");
  await expect(row(page, "Скидка подписчикам Tribute")).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL("/authoring/sales/discounts");
});

test("воронка продаж держит продукт, главу и период в адресе", async ({
  baseURL,
  context,
  page,
}, info) => {
  await signIn(context, baseURL);
  await page.goto("/authoring/sales/funnel");
  await expect(
    page.getByRole("heading", { level: 1, name: "Воронка продаж" }),
  ).toBeVisible();
  await expect(row(page, "channel")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Историческая метрика согласия" }),
  ).toBeVisible();
  await expect(
    page.getByRole("combobox", { name: "Период", exact: true }),
  ).toHaveText("Последние 30 дней");
  await expectAccessibleWithoutOverflow(page);
  if (isPhone(info)) await expectTouchTargets(page.getByRole("main"));

  await choose(page, "Период", "Последние 7 дней");
  await expect(page).toHaveURL(/[?&]period=7(?:&|$)/u);
  await choose(page, "Глава", "Глава 2. Агенты");
  await expect(page).toHaveURL(
    new RegExp(`chapterId=${secondChapter}&period=7$`, "u"),
  );
  await expect(
    page.getByRole("combobox", { name: "Глава", exact: true }),
  ).toHaveText("Глава 2. Агенты");

  await page.reload();
  await expect(
    page.getByRole("combobox", { name: "Глава", exact: true }),
  ).toHaveText("Глава 2. Агенты");
  await page.goBack();
  await expect(page).toHaveURL(/[?&]period=7$/u);
  await expect(
    page.getByRole("combobox", { name: "Глава", exact: true }),
  ).toHaveText("Глава 1. Проекты и локальный MCP");
  await page.goBack();
  await expect(page).toHaveURL("/authoring/sales/funnel");
  await expect(
    page.getByRole("combobox", { name: "Период", exact: true }),
  ).toHaveText("Последние 30 дней");

  await choose(page, "Период", "Свой период");
  const custom = page.getByRole("form", { name: "Свой период" });
  await custom.getByLabel("С", { exact: true }).fill("2026-10-01");
  await custom.getByLabel("По", { exact: true }).fill("2026-10-15");
  await custom.getByRole("button", { name: "Показать" }).click();
  await expect(page).toHaveURL(/from=2026-10-01&to=2026-10-15$/u);
  await expect(
    page.getByRole("main").getByText("1 окт. 2026 – 15 окт. 2026").first(),
  ).toBeVisible();
  await expectAccessibleWithoutOverflow(page);
});

test("воронка продаж без права billing:manage показывает отказ, а не пустой отчёт", async ({
  baseURL,
  context,
  page,
}) => {
  await signIn(context, baseURL, "sales-catalog-forbidden");
  await page.goto("/authoring/sales/funnel");
  await expect(
    page.getByRole("heading", { name: "Нет доступа к отчёту" }),
  ).toBeVisible();
});
