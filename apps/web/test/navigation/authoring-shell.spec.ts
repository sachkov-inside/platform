import { resolve } from "node:path";

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type TestInfo } from "@playwright/test";

import { prepareEvidenceDirectory } from "../../../../scripts/evidence-path.mjs";
import { screenshotWholePage } from "../support/whole-page-screenshot.mjs";

const backendPort = process.env["FAKE_BACKEND_PORT"];
if (backendPort === undefined) throw new Error("FAKE_BACKEND_PORT is required");
const backend = `http://127.0.0.1:${backendPort}`;
const architectureId = "c0110000-0000-4000-8000-000000000001";

async function authorCookie(baseURL: string, token = "collections-author") {
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
      idToken: "shell.id.token",
      refreshToken: "shell-refresh-token",
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

/** Нет горизонтальной прокрутки, Axe чист для всей страницы вместе с каркасом. */
async function expectShellAccessible(page: Page) {
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

async function evidence(page: Page, info: TestInfo, state: string) {
  if (process.env["CAPTURE_ADMIN_SHELL_EVIDENCE"] !== "1") return;
  const directory = await prepareEvidenceDirectory("issue-1720");
  const path = resolve(directory, `live-${state}-${info.project.name}.png`);
  await screenshotWholePage(page, { path });
  await info.attach(`admin-shell-${state}`, { path, contentType: "image/png" });
}

test.beforeEach(async ({ request }) => {
  expect(
    (
      await request.post(`${backend}/__control`, {
        data: { delayMs: 0, unavailable: false },
      })
    ).ok(),
  ).toBe(true);
  expect((await request.post(`${backend}/__collections/reset`)).ok()).toBe(
    true,
  );
  expect((await request.post(`${backend}/__submissions/reset`)).ok()).toBe(
    true,
  );
});

test("the admin shell reaches every section on desktop and through the phone panel and «Ещё» (#1720)", async ({
  context,
  page,
  baseURL,
}, info) => {
  if (baseURL === undefined) throw new Error("baseURL required");
  await context.addCookies([await authorCookie(baseURL)]);
  await page.goto("/authoring");
  await expect(page).toHaveURL(/\/authoring\/products$/u);
  await expect(
    page.getByRole("heading", { level: 1, name: "Продукты" }),
  ).toBeVisible();
  const counter = /^Сдачи, без комментария: \d+$/u;

  if (!phone(info)) {
    const sections = page.getByRole("navigation", { name: "Разделы админки" });
    await expect(
      sections.getByRole("link", { name: "Продукты" }),
    ).toHaveAttribute("aria-current", "page");
    await expect(sections.getByRole("link", { name: counter })).toBeVisible();
    await expect(
      page.getByRole("navigation", { name: "Основные разделы" }),
    ).toBeHidden();
    await expectShellAccessible(page);
    await evidence(page, info, "products");
    await sections.getByRole("link", { name: "Темы" }).click();
    await expect(page).toHaveURL(/\/authoring\/topics$/u);
    await expect(sections.getByRole("link", { name: "Темы" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    return;
  }

  // Телефон: нижняя панель, вкладки подразделов и лист «Ещё».
  await expect(
    page.getByRole("complementary", { name: "Админка" }),
  ).toBeHidden();
  const dock = page.getByRole("navigation", { name: "Основные разделы" });
  await expect(dock.getByRole("link")).toHaveText([
    "Обзор",
    "Люди",
    "Продажи",
    /^Сдачи\d+$/u,
  ]);
  await expect(dock.getByRole("link", { name: counter })).toBeVisible();
  const dockBox = await dock.boundingBox();
  const viewport = page.viewportSize();
  expect(dockBox).not.toBeNull();
  expect((dockBox?.y ?? 0) + (dockBox?.height ?? 0)).toBe(viewport?.height);
  for (const target of await dock.locator("a, button").all()) {
    const box = await target.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  }
  const tabs = page.getByRole("navigation", { name: "Подразделы: Контент" });
  await expect(tabs.getByRole("link", { name: "Продукты" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expectShellAccessible(page);
  await evidence(page, info, "products");

  const more = dock.getByRole("button", { name: "Ещё" });
  await more.click();
  const sheet = page.getByRole("dialog", { name: "Ещё" });
  await expect(sheet).toBeVisible();
  await expect(
    sheet.getByRole("navigation", { name: "Другие разделы" }).getByRole("link"),
  ).toHaveText([
    "Продукты",
    "Материалы",
    "Темы",
    "Ссылки на оплату",
    "Скидки",
    "Воронка продаж",
  ]);
  await expect(
    sheet.getByRole("link", { name: "На публичный сайт" }),
  ).toBeVisible();
  await expectShellAccessible(page);
  await evidence(page, info, "more-sheet");
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  await expect(more).toHaveAttribute("aria-expanded", "false");

  await more.click();
  await sheet.getByRole("link", { name: "Темы" }).click();
  await expect(page).toHaveURL(/\/authoring\/topics$/u);
  await expect(sheet).toBeHidden();
  await expect(tabs.getByRole("link", { name: "Темы" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(more).toHaveAttribute("data-current", "true");

  await dock.getByRole("link", { name: counter }).click();
  await expect(page).toHaveURL(/\/authoring\/submissions$/u);
  await expect(dock.getByRole("link", { name: counter })).toHaveAttribute(
    "aria-current",
    "page",
  );
});

test("global search opens with the shortcut or the button and opens the chosen product (#1720)", async ({
  context,
  page,
  baseURL,
}, info) => {
  if (baseURL === undefined) throw new Error("baseURL required");
  await context.addCookies([await authorCookie(baseURL)]);
  await page.goto("/authoring/topics");
  await expect(
    page.getByRole("heading", { level: 1, name: "Темы" }),
  ).toBeVisible();
  if (phone(info))
    await page.getByRole("button", { name: "Поиск по админке" }).click();
  else await page.keyboard.press("ControlOrMeta+k");
  const dialog = page.getByRole("dialog", { name: "Поиск по админке" });
  const input = dialog.getByRole("combobox", { name: "Что найти" });
  await expect(input).toBeFocused();
  const searched = page.waitForResponse(
    (response) =>
      response.url().includes("/api/authoring/search?query=") &&
      response.status() === 200,
  );
  await input.fill("руководство");
  await searched;
  const products = dialog.getByRole("group", { name: "Продукты" });
  await expect(products.getByRole("option")).toHaveText([
    "Прежнее руководство по развёртываниюАрхив",
  ]);
  await expect(dialog.getByRole("group", { name: "Материалы" })).toHaveCount(0);
  await expectShellAccessible(page);
  await evidence(page, info, "search");

  await input.fill("архитектура");
  await expect(products.getByRole("option")).toHaveText([
    "Архитектура приложения",
  ]);
  await input.press("Enter");
  await expect(page).toHaveURL(`/authoring/products/${architectureId}`);
  await expect(dialog).toBeHidden();
});

test("global search refuses an account without the right instead of answering empty (#1720)", async ({
  context,
  page,
  baseURL,
}) => {
  if (baseURL === undefined) throw new Error("baseURL required");
  await context.addCookies([await authorCookie(baseURL, "search-forbidden")]);
  await page.goto("/authoring/topics");
  await page.getByRole("button", { name: "Поиск по админке" }).click();
  const dialog = page.getByRole("dialog", { name: "Поиск по админке" });
  await dialog.getByRole("combobox", { name: "Что найти" }).fill("архитектура");
  await expect(
    dialog.getByText(
      "Поиск открыт аккаунту с правом управлять материалами или доступом.",
    ),
  ).toBeVisible();
  await expect(dialog.getByRole("option")).toHaveCount(0);
});
