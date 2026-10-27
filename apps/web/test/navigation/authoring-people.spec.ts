import { resolve } from "node:path";

import AxeBuilder from "@axe-core/playwright";
import {
  expect,
  test,
  type BrowserContext,
  type Locator,
  type Page,
  type TestInfo,
} from "@playwright/test";

import { prepareEvidenceDirectory } from "../../../../scripts/evidence-path.mjs";
import { screenshotWholePage } from "../support/whole-page-screenshot.mjs";

const backendPort = process.env["FAKE_BACKEND_PORT"];
if (backendPort === undefined) throw new Error("FAKE_BACKEND_PORT is required");
const backend = `http://127.0.0.1:${backendPort}`;

/** The people of `people-backend.mjs` the checks name. */
const anna = {
  accountId: "d1210000-0000-4000-8000-000000000001",
  name: "Анна Петрова",
};
const konstantin = {
  accountId: "d1210000-0000-4000-8000-000000000002",
  name: "Константин Константинопольский-Задунайский",
};
const products = {
  ai: {
    productId: "c0110000-0000-4000-8000-000000000101",
    name: "AI Engineering: агенты в работе",
  },
  architecture: {
    productId: "c0110000-0000-4000-8000-000000000102",
    name: "Архитектура приложения",
  },
  practice: {
    productId: "c0110000-0000-4000-8000-000000000103",
    name: "Инженерная практика",
  },
} as const;

async function signIn(
  context: BrowserContext,
  baseURL: string | undefined,
  token = "people-owner",
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
      idToken: "people.id.token",
      refreshToken: "people-refresh-token",
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

/** No horizontal scroll at the current width, and Axe is clean for the whole page. */
async function expectAccessibleWithoutOverflow(page: Page) {
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth ===
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
  const scan = await new AxeBuilder({ page }).analyze();
  expect(scan.violations).toEqual([]);
}

/**
 * The desktop page is captured whole; the phone and an open dialog as the screen the person sees,
 * with the fixed bottom panel where it really is.
 */
async function evidence(
  page: Page,
  info: TestInfo,
  state: string,
  { screen = false }: { readonly screen?: boolean } = {},
) {
  if (process.env["CAPTURE_PEOPLE_EVIDENCE"] !== "1") return;
  const directory = await prepareEvidenceDirectory("issue-1721");
  const path = resolve(directory, `live-${state}-${info.project.name}.png`);
  if (screen || info.project.name === "mobile-chromium")
    await page.screenshot({ path });
  else await screenshotWholePage(page, { path });
  await info.attach(`people-${state}`, { path, contentType: "image/png" });
}

/** The visible row of a person: a table row from 40rem of the column, a list item below. */
function personRow(page: Page, name: string): Locator {
  return page
    .getByRole("main")
    .locator("tr:visible, li.admin-list-item:visible")
    .filter({ has: page.getByRole("link", { name, exact: true }) });
}

function productPanel(page: Page, name: string): Locator {
  return page.getByRole("main").getByRole("article", { name, exact: true });
}

async function choose(page: Page, filter: string, option: string) {
  await page
    .getByRole("main")
    .getByRole("combobox", { name: filter, exact: true })
    .click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

async function openCard(page: Page, accountId: string, name: string) {
  await page.goto(`/authoring/people/${accountId}`);
  await expect(
    page.getByRole("heading", { level: 1, name, exact: true }),
  ).toBeVisible();
}

test.beforeEach(async ({ request }) => {
  expect(
    (
      await request.post(`${backend}/__control`, {
        data: { delayMs: 0, unavailable: false },
      })
    ).ok(),
  ).toBe(true);
  expect((await request.post(`${backend}/__people/reset`)).ok()).toBe(true);
});

test("the people list keeps search and filters in the address and opens a card", async ({
  baseURL,
  context,
  page,
}, info) => {
  await signIn(context, baseURL);
  await page.goto("/authoring/people");
  await expect(
    page.getByRole("heading", { level: 1, name: "Люди" }),
  ).toBeVisible();
  await expect(page.getByText("30 человек", { exact: true })).toBeVisible();
  await expect(personRow(page, anna.name)).toBeVisible();
  await expectAccessibleWithoutOverflow(page);
  await evidence(page, info, "list");

  await choose(page, "Продукт", products.architecture.name);
  await expect(page).toHaveURL(
    new RegExp(`product=${products.architecture.productId}`, "u"),
  );
  await choose(page, "Состояние доступа", "Доступ отозван");
  await expect(page).toHaveURL(/state=revoked/u);
  await expect(personRow(page, anna.name)).toBeVisible();
  const chips = page.getByRole("list", { name: "Применённые фильтры" });
  await expect(chips.getByRole("listitem")).toHaveText([
    products.architecture.name,
    "Доступ отозван",
  ]);

  await page.reload();
  await expect(chips.getByRole("listitem")).toHaveCount(2);
  await expect(personRow(page, anna.name)).toBeVisible();
  await page.getByRole("button", { name: "Сбросить" }).click();
  await expect(page).toHaveURL(/\/authoring\/people$/u);
  await expect(page.getByText("30 человек", { exact: true })).toBeVisible();

  await page
    .getByRole("searchbox", { name: "Поиск по имени, @username, email или ID" })
    .fill("anna.petrova@example.test");
  await expect(page).toHaveURL(/q=anna\.petrova%40example\.test/u);
  await expect(page.getByText("Найдено: 1 человек")).toBeVisible();
  await page.getByRole("button", { name: "Очистить поиск" }).click();

  const pages = page.getByRole("navigation", {
    name: "Страницы списка людей",
  });
  await pages.getByRole("link", { name: "Дальше" }).click();
  await expect(page).toHaveURL(/cursor=o%3A25/u);
  await expect(personRow(page, anna.name)).toHaveCount(0);
  await pages.getByRole("link", { name: "К началу списка" }).click();
  await expect(personRow(page, anna.name)).toBeVisible();

  await personRow(page, anna.name)
    .getByRole("link", { name: anna.name })
    .click();
  await expect(page).toHaveURL(`/authoring/people/${anna.accountId}`);
  await expect(
    page.getByRole("heading", { level: 1, name: anna.name }),
  ).toBeVisible();
});

test("the old access address redirects to the people list", async ({
  baseURL,
  context,
  page,
}) => {
  await signIn(context, baseURL);
  await page.goto("/authoring/access");
  await expect(page).toHaveURL(/\/authoring\/people$/u);
  await expect(
    page.getByRole("heading", { level: 1, name: "Люди" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Люди" }).first(),
  ).toHaveAttribute("aria-current", "page");
});

test("a name search that Telegram cannot answer says so instead of «nobody found»", async ({
  baseURL,
  context,
  page,
}) => {
  await signIn(context, baseURL);
  await page.goto("/authoring/people?q=telegram-down");
  await expect(
    page.getByText(
      "Поиск по имени и @username временно недоступен: Telegram сейчас не отвечает. Поиск по email и ID работает.",
    ),
  ).toBeVisible();
  await expect(page.getByText("Никого не нашли")).toHaveCount(0);
});

test("more name matches than the server returns ask to narrow the search without overstating the count", async ({
  baseURL,
  context,
  page,
}) => {
  await signIn(context, baseURL);
  await page.goto("/authoring/people?q=%D0%B0");
  await expect(
    page.getByText("Показаны не все совпадения поиска. Уточните запрос."),
  ).toBeVisible();
  // The double answers its first 20 matches; the count names exactly those.
  await expect(page.getByText("20 человек", { exact: true })).toBeVisible();
});

test("a stale cursor the server refuses starts the list over instead of offering a retry", async ({
  baseURL,
  context,
  page,
}) => {
  await signIn(context, baseURL);
  await page.goto("/authoring/people?state=active&cursor=stale-cursor");
  await expect(
    page.getByRole("heading", { name: "Страница списка устарела" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Повторить" })).toHaveCount(0);
  await page.getByRole("button", { name: "К началу списка" }).click();
  await expect(page).toHaveURL(/\/authoring\/people\?state=active$/u);
  await expect(personRow(page, anna.name)).toBeVisible();
});

test("the owner grants, revokes with a reason and its consequence, and restores in the card", async ({
  baseURL,
  context,
  page,
}, info) => {
  await signIn(context, baseURL);
  await openCard(page, anna.accountId, anna.name);
  await expect(
    page.getByRole("navigation", { name: "Разделы карточки" }),
  ).toBeVisible();
  await expect(page.getByText("Доступ открыт").first()).toBeVisible();
  await expectAccessibleWithoutOverflow(page);
  await evidence(page, info, "card");

  // Grant: the dialog says beforehand what an existing access changes.
  await page.getByRole("button", { name: "Выдать продукт" }).click();
  const grant = page.getByRole("dialog", { name: "Выдать продукт" });
  await grant
    .getByRole("radio", { name: `${products.ai.name} · уже выдан` })
    .check();
  await expect(grant.getByText(/Выдача ничего не изменит/u)).toBeVisible();
  await grant.getByRole("radio", { name: products.practice.name }).check();
  await grant.getByRole("radio", { name: "Подарок" }).check();
  await expectAccessibleWithoutOverflow(page);
  await grant.getByRole("button", { name: "Выдать продукт" }).click();
  await expect(page.getByText("Доступ выдан.")).toBeVisible();
  await expect(grant).toBeHidden();
  await expect(
    productPanel(page, products.practice.name).getByText("Доступ открыт"),
  ).toBeVisible();
  await expect(
    productPanel(page, products.practice.name).getByText("Причина: Подарок", {
      exact: false,
    }),
  ).toBeVisible();

  // Revoke: preview, consequence, required note for «Другое».
  await productPanel(page, products.ai.name)
    .getByRole("button", { name: `Отозвать доступ к «${products.ai.name}»` })
    .click();
  const revoke = page.getByRole("dialog", {
    name: `Отозвать доступ к «${products.ai.name}»?`,
  });
  await expect(revoke.getByText("Материалы продукта закроются.")).toBeVisible();
  await expect(
    revoke.getByText(
      "Остальные продукты, история, оплаты и учебные записи сохранятся.",
    ),
  ).toBeVisible();
  await expect(revoke.getByRole("button", { name: "Отмена" })).toBeFocused();
  await revoke.getByRole("radio", { name: "Другое" }).check();
  await revoke.getByRole("button", { name: "Отозвать доступ" }).click();
  await expect(revoke.getByText("Опишите причину")).toBeVisible();
  await revoke.getByLabel("Заметка").fill("Попросил партнёр");
  await expectAccessibleWithoutOverflow(page);
  await evidence(page, info, "revoke-dialog", { screen: true });
  await revoke.getByRole("button", { name: "Отозвать доступ" }).click();
  await expect(
    page.getByText(`Доступ к «${products.ai.name}» отозван.`),
  ).toBeVisible();
  await expect(
    productPanel(page, products.ai.name).getByText("Доступ отозван"),
  ).toBeVisible();
  await expect(
    productPanel(page, products.ai.name).getByText(
      "Причина: Другое: Попросил партнёр",
      {
        exact: false,
      },
    ),
  ).toBeVisible();

  // Restore: a short reason, no warning, a confirmation notice.
  await productPanel(page, products.architecture.name)
    .getByRole("button", {
      name: `Восстановить доступ к «${products.architecture.name}»`,
    })
    .click();
  const restore = page.getByRole("dialog", {
    name: `Восстановить доступ к «${products.architecture.name}»`,
  });
  await expect(restore.getByLabel("Причина")).toBeFocused();
  await restore.getByLabel("Причина").fill("Оплата нашлась в банке");
  await restore.getByRole("button", { name: "Восстановить доступ" }).click();
  await expect(
    page.getByText(`Доступ к «${products.architecture.name}» восстановлен.`),
  ).toBeVisible();
  await expect(
    productPanel(page, products.architecture.name).getByText("Доступ открыт"),
  ).toBeVisible();

  // The list reads the new state too.
  await page.getByRole("link", { name: "К людям" }).click();
  await expect(
    personRow(page, anna.name).getByText(products.practice.name),
  ).toBeVisible();
});

test("an access changed since the card loaded runs nothing and offers to refresh", async ({
  baseURL,
  context,
  page,
  request,
}) => {
  await signIn(context, baseURL);
  await openCard(page, anna.accountId, anna.name);
  const bump = async (productId: string) => {
    expect(
      (
        await request.post(`${backend}/__people/bump`, {
          data: { accountId: anna.accountId, productId },
        })
      ).ok(),
    ).toBe(true);
  };

  // Revoke: the preview already sees another revision, so the dialog does not open.
  await bump(products.ai.productId);
  await productPanel(page, products.ai.name)
    .getByRole("button", { name: `Отозвать доступ к «${products.ai.name}»` })
    .click();
  const stale = page
    .getByRole("main")
    .getByRole("alert")
    .filter({ hasText: "Доступ изменился, пока была открыта карточка." });
  await expect(stale).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const refreshed = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/authoring/people/${anna.accountId}`) &&
      response.status() === 200,
  );
  await stale.getByRole("button", { name: "Обновить данные" }).click();
  await refreshed;
  await expect(stale).toBeHidden();

  // Restore: the server refuses the stale revision and nothing changes.
  await bump(products.architecture.productId);
  await productPanel(page, products.architecture.name)
    .getByRole("button", {
      name: `Восстановить доступ к «${products.architecture.name}»`,
    })
    .click();
  const restore = page.getByRole("dialog", {
    name: `Восстановить доступ к «${products.architecture.name}»`,
  });
  await restore.getByLabel("Причина").fill("Оплата нашлась в банке");
  await restore.getByRole("button", { name: "Восстановить доступ" }).click();
  await expect(restore).toBeHidden();
  await expect(stale).toBeVisible();
  await expect(
    productPanel(page, products.architecture.name).getByText("Доступ отозван"),
  ).toBeVisible();
  await stale.getByRole("button", { name: "Обновить данные" }).click();
  await expect(stale).toBeHidden();
});

test("blocks that failed stay local and a hidden right reads as a neutral note", async ({
  baseURL,
  context,
  page,
}) => {
  await signIn(context, baseURL);
  await openCard(page, konstantin.accountId, konstantin.name);
  await expect(
    page.getByText("Оплаты сейчас не удалось загрузить", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByText("Данные Telegram сейчас не удалось загрузить", {
      exact: false,
    }),
  ).toBeVisible();
  await expect(
    page.getByText("Сдачи видит аккаунт с правом управлять материалами."),
  ).toBeVisible();
  await expect(
    productPanel(page, products.ai.name).getByText("Доступ открыт"),
  ).toBeVisible();
  await expectAccessibleWithoutOverflow(page);
});

test("a payment in the card opens its page and «Все оплаты» opens the person's payments (#1717)", async ({
  baseURL,
  context,
  page,
}) => {
  await signIn(context, baseURL);
  await openCard(page, anna.accountId, anna.name);
  const payments = page.getByRole("region", {
    name: "Оплаты и ссылки",
    exact: true,
  });
  const payment = payments
    .locator("tr:visible, li.admin-list-item:visible")
    .getByRole("link", { name: products.ai.name, exact: true });
  await expect(payment).toHaveAttribute(
    "href",
    "/authoring/sales/payments/e1210000-0000-4000-8000-000000000001",
  );
  const all = payments.getByRole("link", { name: "Все оплаты", exact: true });
  await expect(all).toHaveAttribute(
    "href",
    `/authoring/sales/payments?person=${anna.accountId}`,
  );
  // The shared Button control owns the phone target: 36 px visible, 44 px touch area.
  await expect(all).toHaveAttribute("data-slot", "button");
  await expectAccessibleWithoutOverflow(page);
});

test("empty, failed and unknown people answer with their own states", async ({
  baseURL,
  browser,
}) => {
  if (baseURL === undefined) throw new Error("baseURL is required");
  const empty = await browser.newContext({ baseURL });
  const failed = await browser.newContext({ baseURL });
  try {
    await signIn(empty, baseURL, "people-empty");
    const emptyPage = await empty.newPage();
    await emptyPage.goto("/authoring/people");
    await expect(
      emptyPage.getByRole("heading", { name: "Людей пока нет" }),
    ).toBeVisible();

    await signIn(failed, baseURL, "people-unavailable");
    const failedPage = await failed.newPage();
    await failedPage.goto("/authoring/people");
    const alert = failedPage
      .getByRole("main")
      .getByRole("alert")
      .filter({ hasText: "Не удалось открыть список" });
    await expect(alert).toBeVisible();
    await expect(alert.getByText("Код обращения:")).toBeVisible();
    await expect(
      alert.getByRole("button", { name: "Повторить" }),
    ).toBeVisible();

    await signIn(empty, baseURL, "people-owner");
    await emptyPage.goto(
      "/authoring/people/d1210000-0000-4000-8000-0000000009ff",
    );
    await expect(
      emptyPage.getByRole("heading", { name: "Человек не найден" }),
    ).toBeVisible();
    await expect(
      emptyPage.getByRole("link", { name: "К списку людей" }),
    ).toHaveAttribute("href", "/authoring/people");
  } finally {
    await empty.close();
    await failed.close();
  }
});

test("the «Люди» group of the global search opens the person card", async ({
  baseURL,
  context,
  page,
}, info) => {
  await signIn(context, baseURL);
  await page.goto("/authoring/people");
  await expect(
    page.getByRole("heading", { level: 1, name: "Люди" }),
  ).toBeVisible();
  if (info.project.name === "mobile-chromium")
    await page.getByRole("button", { name: "Поиск по админке" }).click();
  else await page.keyboard.press("ControlOrMeta+k");
  const dialog = page.getByRole("dialog", { name: "Поиск по админке" });
  await dialog.getByRole("combobox", { name: "Что найти" }).fill("анна");
  const group = dialog.getByRole("group", { name: "Люди" });
  await expect(group.getByRole("option")).toHaveText([
    `${anna.name}@anna_petrova · anna.petrova@example.test`,
  ]);
  await dialog.getByRole("combobox", { name: "Что найти" }).press("Enter");
  await expect(page).toHaveURL(`/authoring/people/${anna.accountId}`);
  await expect(
    page.getByRole("heading", { level: 1, name: anna.name }),
  ).toBeVisible();
});
