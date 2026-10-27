import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { z } from "zod";

const backendPort = process.env["FAKE_BACKEND_PORT"];
if (backendPort === undefined) throw new Error("FAKE_BACKEND_PORT is required");
const backend = `http://127.0.0.1:${backendPort}`;

// Те же значения, что у `product-learners-backend.mjs` и `people-backend.mjs`.
const productId = "c0110000-0000-4000-8000-000000000001";
const productName = "Архитектура приложения";
const annaId = "d1210000-0000-4000-8000-000000000001";
const konstantinId = "d1210000-0000-4000-8000-000000000002";
const failingId = "d1210000-0000-4000-8000-000000000003";
const contactlessId = "e1210000-0000-4000-8000-000000000009";
const konstantin = "Константин Константинопольский-Задунайский";
const failingEmail = "buyer.only@example.test";

const commandsSchema = z.object({
  commands: z.array(
    z.object({
      accountId: z.string(),
      productId: z.string(),
      sourceRef: z.string(),
      reason: z.string(),
    }),
  ),
});

async function ownerCookie(baseURL: string) {
  const { wrapSession } = await import("@logto/node");
  const session = await wrapSession(
    {
      accessToken: JSON.stringify({
        [`@${backend}`]: {
          // deterministic-test-allow wall-clock: The live Web process and Logto validate this session against their real clock; it carries no calendar-dependent domain assertion.
          expiresAt: Math.floor(Date.now() / 1_000) + 3_600,
          scope: "",
          token: "collections-author",
        },
      }),
      idToken: "learners.id.token",
      refreshToken: "learners-refresh-token",
    },
    "inside-navigation-logto-cookie-secret-key",
  );
  return {
    httpOnly: true,
    name: "logto_inside-web-navigation",
    sameSite: "Lax" as const,
    url: baseURL,
    value: session,
  };
}

function phone(info: TestInfo): boolean {
  return info.project.name === "mobile-chromium";
}

/** Таблица на компьютере, список строк на телефоне: в дереве доступности ровно одна из них. */
function learnerRows(page: Page, info: TestInfo) {
  const name = "Ученики продукта";
  return phone(info)
    ? page.getByRole("list", { name }).getByRole("listitem")
    : page.getByRole("table", { name }).locator("tbody tr");
}

async function expectAccessibleWithoutOverflow(page: Page) {
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth ===
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
  const scan = await new AxeBuilder({ page }).include("main").analyze();
  expect(scan.violations).toEqual([]);
}

test.beforeEach(async ({ context, request, baseURL }) => {
  if (baseURL === undefined) throw new Error("baseURL required");
  expect(
    (
      await request.post(`${backend}/__control`, {
        data: { delayMs: 0, unavailable: false },
      })
    ).ok(),
  ).toBe(true);
  for (const reset of [
    "__collections/reset",
    "__product-sale/reset",
    "__product-learners/reset",
  ])
    expect((await request.post(`${backend}/${reset}`)).ok()).toBe(true);
  await context.addCookies([await ownerCookie(baseURL)]);
});

test("learners tab lists holders by name and grants several people with one retry (#1718)", async ({
  page,
  request,
}, info) => {
  await page.goto(`/authoring/products/${productId}`);
  const tab = page.getByRole("tab", { name: "Ученики", exact: true });
  await tab.click();
  await expect(page).toHaveURL(`/authoring/products/${productId}?tab=learners`);
  await expect(tab).toHaveAttribute("aria-selected", "true");

  // Подписи людей читаются одним запросом на страницу; ID без контактов не становится названием.
  const rows = learnerRows(page, info);
  await expect(rows).toHaveCount(2);
  await expect(
    rows.first().getByRole("link", { name: "Анна Петрова" }),
  ).toHaveAttribute("href", `/authoring/people/${annaId}`);
  await expect(
    rows.nth(1).getByRole("link", { name: "Аккаунт без контактов" }),
  ).toHaveAttribute("href", `/authoring/people/${contactlessId}`);
  await expect(page.getByText(contactlessId)).toHaveCount(0);
  await expectAccessibleWithoutOverflow(page);

  // Тот же адрес открывает вкладку сразу.
  await page.reload();
  await expect(tab).toHaveAttribute("aria-selected", "true");
  await expect(rows).toHaveCount(2);

  await page.getByRole("button", { name: "Выдать продукт" }).click();
  const dialog = page.getByRole("dialog", { name: `Выдать «${productName}»` });
  await expect(dialog).toBeVisible();
  const search = dialog.getByRole("searchbox", { name: "Найти человека" });
  for (const [query, name] of [
    ["Анна", "Анна Петрова"],
    ["конст", konstantin],
    [failingEmail, failingEmail],
  ] as const) {
    await search.fill(query);
    await dialog.getByRole("button", { name: `Добавить ${name}` }).click();
  }
  const chosen = dialog.getByRole("list", { name: "Выбранные люди" });
  await expect(chosen.getByText("Уже есть доступ")).toBeVisible();
  await dialog.getByRole("radio", { name: "Подарок" }).check();
  await dialog.getByRole("button", { name: "Выдать 2 людям" }).click();

  const status = dialog.getByRole("status").first();
  await expect(status).toHaveText(
    "Готово: выдано 1, уже был доступ у 1, не удалось 1.",
  );
  const outcome = dialog.getByRole("list", { name: "Итог выдачи" });
  await expect(outcome.getByRole("listitem")).toHaveCount(3);
  await expect(
    page.evaluate(
      () =>
        document.documentElement.scrollWidth ===
        document.documentElement.clientWidth,
    ),
  ).resolves.toBe(true);

  // Повтор отправляет только строку с ошибкой и с той же ссылкой выдачи.
  await dialog
    .getByRole("button", { name: "Повторить для 1 человека" })
    .click();
  await expect(status).toHaveText("Готово: выдано 2, уже был доступ у 1.");
  await expect(dialog.getByRole("button", { name: /^Повторить/u })).toHaveCount(
    0,
  );
  const { commands } = commandsSchema.parse(
    await (await request.get(`${backend}/__product-learners/commands`)).json(),
  );
  expect(commands.map((command) => command.accountId)).toEqual(
    expect.arrayContaining([konstantinId, failingId, failingId]),
  );
  expect(commands).toHaveLength(3);
  const failing = commands.filter((command) => command.accountId === failingId);
  expect(failing[1]).toEqual(failing[0]);
  expect(failing[0]?.reason).toBe("Подарок");
  expect(
    new Set(commands.map((command) => command.sourceRef.split(":")[1])).size,
  ).toBe(1);

  await dialog.getByRole("button", { name: "Готово" }).click();
  await expect(dialog).toBeHidden();
  await expect(rows).toHaveCount(4);
  await expect(rows.getByRole("link", { name: konstantin })).toBeVisible();
  await expect(rows.getByRole("link", { name: failingEmail })).toBeVisible();
  await expectAccessibleWithoutOverflow(page);
});
