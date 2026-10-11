import { resolve } from "node:path";

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type TestInfo } from "@playwright/test";

import { prepareEvidenceDirectory } from "../../../../scripts/evidence-path.mjs";
import { screenshotWholePage } from "../support/whole-page-screenshot.mjs";

const productId = "00000000-0000-4000-8000-000000000948";
const chapterId = "00000000-0000-4000-8000-000000000950";
const firstId = "30000000-0000-4000-8000-000000000003";
const backendPort = process.env["FAKE_BACKEND_PORT"];
if (backendPort === undefined) throw new Error("FAKE_BACKEND_PORT is required");
const backend = `http://127.0.0.1:${backendPort}`;

async function authorCookie(baseURL: string, token = "submissions-author") {
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
      idToken: "submissions.id.token",
      refreshToken: "submissions-refresh-token",
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

async function evidence(page: Page, info: TestInfo, state: string) {
  await page
    .getByRole("heading", {
      level: 1,
      name: /^(Сдачи|Онбординг команды|Заявки клиентов)$/u,
    })
    .click();
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth ===
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
  const a11y = await new AxeBuilder({ page }).include("main").analyze();
  expect(a11y.violations).toEqual([]);
  if (process.env["CAPTURE_SUBMISSIONS_EVIDENCE"] !== "1") return;
  const directory = await prepareEvidenceDirectory("issue-1351");
  const path = resolve(directory, `live-${state}-${info.project.name}.png`);
  await screenshotWholePage(page, { path });
  await info.attach(`submissions-${state}`, { path, contentType: "image/png" });
}

test.beforeEach(async ({ request }) => {
  expect(
    (
      await request.post(`${backend}/__control`, {
        data: { delayMs: 0, unavailable: false },
      })
    ).ok(),
  ).toBe(true);
  expect((await request.post(`${backend}/__submissions/reset`)).ok()).toBe(
    true,
  );
});

test("production streams the loading state before the list arrives (#1351)", async ({
  context,
  page,
  request,
  baseURL,
}, info) => {
  if (baseURL === undefined) throw new Error("baseURL required");
  await context.addCookies([await authorCookie(baseURL)]);
  await request.post(`${backend}/__submissions/hold`, { data: { hold: true } });
  try {
    await page.goto("/authoring/submissions", { waitUntil: "commit" });
    await expect(
      page.getByRole("status", { name: "Загружаем сдачи" }),
    ).toBeVisible();
    await evidence(page, info, "loading");
  } finally {
    await request.post(`${backend}/__submissions/hold`, {
      data: { hold: false },
    });
  }
  await expect(page.getByRole("region", { name: "Список сдач" })).toBeVisible();
});

test("list, separate addresses, saved history and filter/page return preserve drafts (#1351)", async ({
  context,
  page,
  baseURL,
}, info) => {
  if (baseURL === undefined) throw new Error("baseURL required");
  await context.addCookies([await authorCookie(baseURL)]);
  await page.goto(`/authoring/submissions?productId=${productId}`);
  const list = page.getByRole("list", { name: "Сдачи, новые сверху" });
  await expect(list.getByRole("link")).toHaveCount(2);
  await expect(page.locator("[data-submission]")).toHaveCount(0);
  await evidence(page, info, "list");
  await list.getByRole("link").first().press("Enter");
  await expect(page).toHaveURL(new RegExp(`submission=${firstId}`));
  const first = page.locator(`[data-submission="${firstId}"]`);
  await page.getByText("Оставить комментарий ученику", { exact: true }).click();
  await first.getByRole("textbox").fill("Черновик первой сдачи");
  await page.getByText("Подробный отчёт по критериям", { exact: true }).click();
  await expect(first.getByText(/<img src=x onerror/u)).toBeVisible();
  await expect(page.locator('img[src="x"]')).toHaveCount(0);
  await page.getByText("Проект и заметка ученика", { exact: true }).click();
  await evidence(page, info, "expanded");
  const history = page.getByRole("region", { name: "История самопроверок" });
  await expect(history.getByRole("link")).toHaveCount(2);
  await history.getByRole("link").last().click();
  await expect(
    page.getByText("Версия требований 1 (сейчас 2)", { exact: false }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Все сдачи" })).toHaveAttribute(
    "href",
    `/authoring/submissions?productId=${productId}`,
  );
  await page.getByRole("link", { name: "Все сдачи" }).click();
  await list.getByRole("link").first().click();
  await page.getByText("Оставить комментарий ученику", { exact: true }).click();
  await expect(first.getByRole("textbox")).toHaveValue("Черновик первой сдачи");
  await page.getByRole("link", { name: "Все сдачи" }).click();
  await page.getByRole("link", { name: "Более ранние сдачи" }).click();
  const older = page.getByRole("list", { name: "Сдачи, новые сверху" });
  await older.getByRole("link").first().click();
  await expect(page.getByRole("link", { name: "Все сдачи" })).toHaveAttribute(
    "href",
    `/authoring/submissions?productId=${productId}&cursor=page-2`,
  );
  await page.getByRole("link", { name: "Все сдачи" }).click();
  await page.getByRole("link", { name: "К новым сдачам" }).click();
  await expect(page).toHaveURL(new RegExp(`productId=${productId}$`));
  await expect(list.getByRole("link")).toHaveCount(2);
  await page
    .getByRole("combobox", { name: "Глава", exact: true })
    .selectOption(chapterId);
  await page.getByRole("button", { name: "Показать", exact: true }).click();
  await expect(list.getByRole("link")).toHaveCount(1);
  await list.getByRole("link").first().click();
  await expect(
    page.getByText("Telegram не привязан", { exact: true }),
  ).toBeVisible();
  await page.getByText("Подробный отчёт ученика", { exact: true }).click();
  await expect(
    page.getByText("Проверил сам: заявка создаётся, повтор не создаёт вторую."),
  ).toBeVisible();
});

test("comment save and failure retain the right draft across route navigation (#1351)", async ({
  context,
  page,
  baseURL,
}) => {
  if (baseURL === undefined) throw new Error("baseURL required");
  await context.addCookies([await authorCookie(baseURL)]);
  await page.goto(`/authoring/submissions?submission=${firstId}`);
  await page.getByText("Оставить комментарий ученику", { exact: true }).click();
  const text = page.getByRole("textbox");
  await text.fill("Первый комментарий");
  let release: (() => void) | undefined;
  let handled: (() => void) | undefined;
  const completed = new Promise<void>((resolve) => {
    handled = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/authoring/product-tasks/feedback", async (route) => {
    await gate;
    await route.continue();
    handled?.();
  });
  await page.getByRole("button", { name: "Сохранить комментарий" }).click();
  await expect(page.getByRole("button", { name: "Сохраняем…" })).toBeDisabled();
  await page.getByRole("link", { name: "Все сдачи" }).click();
  release?.();
  await completed;
  await page.unroute("**/api/authoring/product-tasks/feedback");
  await page
    .getByRole("list", { name: "Сдачи, новые сверху" })
    .getByRole("link")
    .first()
    .click();
  const disclosure = page.locator(".feedback-disclosure");
  await expect(disclosure).toBeVisible();
  if (!(await text.isVisible())) await disclosure.locator("summary").click();
  await expect(text).toHaveValue("Первый комментарий");
  await page.route("**/api/authoring/product-tasks/feedback", (route) =>
    route.fulfill({ status: 503, json: { kind: "unavailable" } }),
  );
  await text.fill("Новый черновик");
  await page.getByRole("button", { name: "Сохранить комментарий" }).click();
  await expect(
    page.getByRole("form", { name: "Комментарий автора" }).getByRole("alert"),
  ).toHaveText(/Не удалось сохранить/u);
  await expect(text).toHaveValue("Новый черновик");
  await page.unroute("**/api/authoring/product-tasks/feedback");
  await page.getByRole("button", { name: "Сохранить комментарий" }).click();
  await expect(
    page.getByText("Сохранено. Ученик увидит комментарий на странице задания."),
  ).toBeVisible();
  await page.reload();
  await expect(text).toHaveValue("Новый черновик");
});

test("missing and malformed submission addresses never silently open another report (#1351)", async ({
  context,
  page,
  baseURL,
}, info) => {
  if (baseURL === undefined) throw new Error("baseURL required");
  await context.addCookies([await authorCookie(baseURL)]);
  for (const id of ["missing", "30000000-0000-4000-8000-000000000999"]) {
    await page.goto(`/authoring/submissions?submission=${id}`);
    await expect(
      page.getByText("Сдача не найдена", { exact: true }),
    ).toBeVisible();
    await expect(page.locator("[data-submission]")).toHaveCount(0);
  }
  await evidence(page, info, "not-found");
});

for (const [state, token, text] of [
  ["denied", "submissions-forbidden", "Нет доступа к сдачам"],
  ["expired", "submissions-expired", "Нужен вход"],
  ["load-error", "submissions-unavailable", "Сдачи не загрузились"],
  ["empty", "submissions-empty", "Сдач пока нет"],
] as const) {
  test(`the live production route displays ${state} without a report (#967)`, async ({
    context,
    page,
    baseURL,
  }, info) => {
    if (baseURL === undefined) throw new Error("baseURL is required");
    await context.addCookies([await authorCookie(baseURL, token)]);
    await page.goto("/authoring/submissions");
    await expect(page.getByText(text, { exact: true })).toBeVisible();
    await expect(page.locator("[data-submission]")).toHaveCount(0);
    await evidence(page, info, state);
  });
}
