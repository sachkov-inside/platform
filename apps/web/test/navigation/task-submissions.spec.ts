import { resolve } from "node:path";

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type TestInfo } from "@playwright/test";

import { prepareEvidenceDirectory } from "../../../../scripts/evidence-path.mjs";
import { screenshotWholePage } from "../support/whole-page-screenshot.mjs";

const productId = "00000000-0000-4000-8000-000000000948";
const chapterId = "00000000-0000-4000-8000-000000000950";
const firstId = "30000000-0000-4000-8000-000000000003";
const secondId = "30000000-0000-4000-8000-000000000002";
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
    .getByRole("heading", { level: 1, name: "Сдачи", exact: true })
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
  const directory = await prepareEvidenceDirectory("issue-967");
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

test("the live production route streams the loading state before the submissions arrive (#967)", async ({
  context,
  page,
  request,
  baseURL,
}, info) => {
  if (baseURL === undefined) throw new Error("baseURL is required");
  await context.addCookies([await authorCookie(baseURL)]);
  expect(
    (
      await request.post(`${backend}/__submissions/hold`, {
        data: { hold: true },
      })
    ).ok(),
  ).toBe(true);
  try {
    await page.goto("/authoring/submissions", { waitUntil: "commit" });
    await expect(
      page.getByRole("status", { name: "Загружаем сдачи" }),
    ).toBeVisible();
    await evidence(page, info, "loading");
  } finally {
    expect(
      (
        await request.post(`${backend}/__submissions/hold`, {
          data: { hold: false },
        })
      ).ok(),
    ).toBe(true);
  }
  await expect(
    page.getByRole("region", { name: "Очередь сдач" }),
  ).toBeVisible();
});

test("author selection, filters and pagination preserve each draft on the live production route (#967)", async ({
  context,
  page,
  baseURL,
}, info) => {
  if (baseURL === undefined) throw new Error("baseURL is required");
  await context.addCookies([await authorCookie(baseURL)]);
  await page.goto("/authoring/submissions");
  const queue = page.getByRole("region", { name: "Очередь сдач" });
  const first = page.locator(`[data-submission="${firstId}"]`);
  await expect(first.getByText(/<img src=x onerror="alert/u)).toBeVisible();
  await expect(page.locator('img[src="x"]')).toHaveCount(0);
  await expect(page.locator("[data-submission]")).toHaveCount(1);
  const q = await queue.boundingBox();
  const d = await first.boundingBox();
  expect(q).not.toBeNull();
  expect(d).not.toBeNull();
  if (info.project.name === "desktop-chromium")
    expect(d?.x ?? 0).toBeGreaterThan((q?.x ?? 0) + (q?.width ?? 0));
  else expect(d?.y ?? 0).toBeGreaterThan((q?.y ?? 0) + (q?.height ?? 0));
  await evidence(page, info, "ready");
  await first.getByRole("textbox").fill("Черновик первой сдачи");
  await queue.getByRole("button", { name: /Заявки клиентов/u }).press("Enter");
  const second = page.locator(`[data-submission="${secondId}"]`);
  await expect(
    second.getByText(
      "Проверил сам: заявка создаётся, повтор не создаёт вторую.",
    ),
  ).toBeVisible();
  await second.getByRole("textbox").fill("Черновик второй сдачи");
  await page.getByRole("combobox", { name: "Продукт" }).selectOption(productId);
  await page.getByRole("combobox", { name: "Глава" }).selectOption(chapterId);
  await page.getByRole("button", { name: "Показать", exact: true }).click();
  await expect(queue.getByRole("button")).toHaveCount(1);
  await expect(second.getByRole("textbox")).toHaveValue(
    "Черновик второй сдачи",
  );
  await page.getByRole("combobox", { name: "Продукт" }).selectOption("");
  await expect(page.getByRole("combobox", { name: "Глава" })).toHaveValue("");
  await page.getByRole("button", { name: "Показать", exact: true }).click();
  await expect(queue.getByRole("button")).toHaveCount(2);
  await queue.getByRole("button", { name: /Онбординг команды/u }).click();
  await expect(first.getByRole("textbox")).toHaveValue("Черновик первой сдачи");
  await page.getByRole("link", { name: "Более ранние сдачи" }).click();
  await expect(page.getByText("Версия требований 1 (сейчас 2)")).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Продукт" })).toHaveValue("");
  await page.getByText("Критерии версии 1").click();
  await expect(page.getByText("Второй агент проверяет выдачу.")).toHaveCount(0);
  await evidence(page, info, "historical-version");
  await page.getByRole("link", { name: "К новым сдачам" }).click();
  await expect(first.getByRole("textbox")).toHaveValue("Черновик первой сдачи");
  await queue.getByRole("button", { name: /Заявки клиентов/u }).click();
  await expect(second.getByRole("textbox")).toHaveValue(
    "Черновик второй сдачи",
  );
});

test("a pending save belongs to its submission; a failed save retains drafts and repeated editing saves the latest feedback (#967)", async ({
  context,
  page,
  baseURL,
}, info) => {
  if (baseURL === undefined) throw new Error("baseURL is required");
  await context.addCookies([await authorCookie(baseURL)]);
  await page.goto("/authoring/submissions");
  const first = page.locator(`[data-submission="${firstId}"]`);
  const queue = page.getByRole("region", { name: "Очередь сдач" });
  await first.getByRole("textbox").fill("Первый сохранённый отзыв");
  await first.getByRole("checkbox").check();
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolveGate) => {
    release = resolveGate;
  });
  await page.route("**/api/authoring/product-tasks/feedback", async (route) => {
    await gate;
    await route.continue();
  });
  try {
    await first.getByRole("button", { name: "Сохранить отзыв" }).click();
    await expect(
      first.getByRole("button", { name: "Сохраняем…" }),
    ).toBeDisabled();
    await queue.getByRole("button", { name: /Заявки клиентов/u }).click();
    const second = page.locator(`[data-submission="${secondId}"]`);
    await second.getByRole("textbox").fill("Другой несохранённый отзыв");
    release?.();
    await expect(
      queue.getByRole("button", { name: /Онбординг команды/u }),
    ).toContainText("Посмотрел автор");
    await expect(second.getByRole("textbox")).toHaveValue(
      "Другой несохранённый отзыв",
    );
  } finally {
    release?.();
    await page.unroute("**/api/authoring/product-tasks/feedback");
  }
  await queue.getByRole("button", { name: /Онбординг команды/u }).click();
  await expect(first.getByRole("textbox")).toHaveValue(
    "Первый сохранённый отзыв",
  );
  await first.getByRole("textbox").fill("Исправленный отзыв");
  await page.route("**/api/authoring/product-tasks/feedback", (route) =>
    route.fulfill({ status: 503, body: "unavailable" }),
  );
  await first.getByRole("button", { name: "Сохранить отзыв" }).click();
  await expect(first.getByRole("alert")).toContainText("Не удалось сохранить");
  await expect(first.getByRole("textbox")).toHaveValue("Исправленный отзыв");
  await evidence(page, info, "save-error");
  await page.unroute("**/api/authoring/product-tasks/feedback");
  await first.getByRole("button", { name: "Сохранить отзыв" }).click();
  await expect(
    first.getByText("Сохранено. Ученик увидит отзыв на странице задания."),
  ).toBeVisible();
  await expect(
    first.getByRole("button", { name: "Сохранить отзыв" }),
  ).toBeDisabled();
  await evidence(page, info, "saved-feedback");
  await page.reload();
  await expect(first.getByRole("textbox")).toHaveValue("Исправленный отзыв");
  await expect(first.getByRole("checkbox")).toBeChecked();
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
