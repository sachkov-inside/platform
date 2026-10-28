import { resolve } from "node:path";

import AxeBuilder from "@axe-core/playwright";
import {
  expect,
  test,
  type APIRequestContext,
  type Page,
  type TestInfo,
} from "@playwright/test";
import { z } from "zod";

import { prepareEvidenceDirectory } from "../../../../scripts/evidence-path.mjs";
import { screenshotWholePage } from "../support/whole-page-screenshot.mjs";

const productId = "00000000-0000-4000-8000-000000000948";
const chapterId = "00000000-0000-4000-8000-000000000950";
const firstId = "30000000-0000-4000-8000-000000000003";
const olderAnnaId = "30000000-0000-4000-8000-000000000001";
const formId = "30000000-0000-4000-8000-000000000002";
const olgaId = "30000000-0000-4000-8000-000000000004";
const rowsName = "Сдачи, новые сверху";
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

/** Row links of the list: the table from 48rem, the phone list below; only one is rendered visible. */
function rowLinks(page: Page, info: TestInfo) {
  return page
    .getByRole(info.project.name === "mobile-chromium" ? "list" : "table", {
      name: rowsName,
    })
    .getByRole("link");
}

/** Which submissions the page lists, as their addresses say. */
async function listedIds(page: Page, info: TestInfo): Promise<string[]> {
  const hrefs = await rowLinks(page, info).evaluateAll((links) =>
    links.map((link) => link.getAttribute("href") ?? ""),
  );
  return hrefs.map(
    (href) =>
      new URL(href, "http://local.test").searchParams.get("submission") ?? "",
  );
}

/** The «Сдачи» counter: the sidebar on desktop, the bottom panel «Основные разделы» on phones. */
function counterLink(page: Page, info: TestInfo, count: number | null) {
  return page
    .getByRole("navigation", {
      name:
        info.project.name === "mobile-chromium"
          ? "Основные разделы"
          : "Разделы админки",
    })
    .getByRole("link", {
      name:
        count === null ? "Сдачи" : `Сдачи, без комментария: ${String(count)}`,
      exact: true,
    });
}

async function choose(page: Page, filter: string, option: string) {
  await page.getByRole("combobox", { name: filter, exact: true }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

async function backendReads(
  request: APIRequestContext,
): Promise<URLSearchParams[]> {
  const response = await request.get(`${backend}/__submissions/reads`);
  expect(response.ok()).toBe(true);
  const { reads } = z
    .object({ reads: z.array(z.string()) })
    .parse(await response.json());
  return reads.map((search) => new URLSearchParams(search));
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
      page.getByRole("region", { name: "Загружаем сдачи" }),
    ).toBeVisible();
    await evidence(page, info, "loading");
  } finally {
    await request.post(`${backend}/__submissions/hold`, {
      data: { hold: false },
    });
  }
  await expect(page.getByRole("region", { name: "Список сдач" })).toBeVisible();
});

test("the default view asks the backend for new submissions; «Все сдачи» and the cursor keep the choice (#1717)", async ({
  context,
  page,
  request,
  baseURL,
}, info) => {
  if (baseURL === undefined) throw new Error("baseURL required");
  await context.addCookies([await authorCookie(baseURL)]);
  await page.goto("/authoring/submissions");
  await expect(rowLinks(page, info)).toHaveCount(2);
  expect(await listedIds(page, info)).toEqual([firstId, olderAnnaId]);
  const first = (await backendReads(request)).at(-1);
  expect(first?.get("feedback")).toBe("awaiting");
  expect(first?.has("cursor")).toBe(false);
  await expect(
    page
      .getByRole("list", { name: "Применённые фильтры" })
      .getByText("Без комментария", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Сбросить" })).toHaveCount(0);
  await expect(counterLink(page, info, 3)).toBeVisible();
  await evidence(page, info, "default-view");

  await page.getByRole("link", { name: "Более ранние", exact: true }).click();
  await expect(page).toHaveURL(/\/authoring\/submissions\?cursor=page-2$/u);
  await expect(rowLinks(page, info)).toHaveCount(1);
  expect(await listedIds(page, info)).toEqual([olgaId]);
  await expect(
    rowLinks(page, info).getByText("@olga_example", { exact: true }),
  ).toBeVisible();
  const older = (await backendReads(request)).at(-1);
  expect(older?.get("feedback")).toBe("awaiting");
  expect(older?.get("cursor")).toBe("page-2");
  await page.getByRole("link", { name: "К новым", exact: true }).click();
  await expect(page).toHaveURL(`${baseURL}/authoring/submissions`);
  await expect(rowLinks(page, info)).toHaveCount(2);

  await choose(page, "Комментарий автора", "Все сдачи");
  await expect(page).toHaveURL(/\/authoring\/submissions\?feedback=all$/u);
  await expect.poll(() => listedIds(page, info)).toEqual([firstId, formId]);
  expect((await backendReads(request)).at(-1)?.has("feedback")).toBe(false);
  await expect(
    page.getByRole("list", { name: "Применённые фильтры" }),
  ).toHaveCount(0);
  await page.getByRole("link", { name: "Более ранние", exact: true }).click();
  await expect(page).toHaveURL(/\?feedback=all&cursor=page-2$/u);
  await expect.poll(() => listedIds(page, info)).toEqual([olderAnnaId, olgaId]);
  await rowLinks(page, info).first().click();
  await expect(page.getByRole("link", { name: "Все сдачи" })).toHaveAttribute(
    "href",
    "/authoring/submissions?feedback=all&cursor=page-2",
  );
  await page.getByRole("link", { name: "Все сдачи" }).click();

  await choose(page, "Комментарий автора", "С комментарием");
  await expect(page).toHaveURL(/\?feedback=given$/u);
  await expect.poll(() => listedIds(page, info)).toEqual([formId]);
  expect((await backendReads(request)).at(-1)?.get("feedback")).toBe("given");
  await page.getByRole("button", { name: "Сбросить" }).click();
  await expect(page).toHaveURL(`${baseURL}/authoring/submissions`);
  await expect
    .poll(() => listedIds(page, info))
    .toEqual([firstId, olderAnnaId]);
});

test("a saved comment lowers the shell counter and leaves the default view (#1717)", async ({
  context,
  page,
  request,
  baseURL,
}, info) => {
  if (baseURL === undefined) throw new Error("baseURL required");
  await context.addCookies([await authorCookie(baseURL)]);
  await page.goto("/authoring/submissions");
  await expect(counterLink(page, info, 3)).toBeVisible();
  await rowLinks(page, info).first().click();
  await expect(page).toHaveURL(new RegExp(`\\?submission=${firstId}$`, "u"));
  const card = page.locator(`[data-submission="${firstId}"]`);
  await page.getByText("Оставить комментарий ученику", { exact: true }).click();
  await card
    .getByRole("textbox", { name: /Комментарий для ученика/u })
    .fill("Проверку роли перенесите на сервер.");
  await card.getByRole("button", { name: "Сохранить комментарий" }).click();
  await expect(
    card.getByText("Сохранено. Ученик увидит комментарий на странице задания."),
  ).toBeVisible();
  await expect(counterLink(page, info, 2)).toBeVisible();
  await evidence(page, info, "commented");

  // The detail address still opens the commented submission: a detail read sends no filter.
  await page.reload();
  await expect(
    page
      .locator(`[data-submission="${firstId}"]`)
      .getByRole("textbox", { name: /Комментарий для ученика/u }),
  ).toHaveValue("Проверку роли перенесите на сервер.");
  expect(
    (await backendReads(request))
      .filter((read) => read.get("submissionId") === firstId)
      .every((read) => !read.has("feedback")),
  ).toBe(true);

  await page.getByRole("link", { name: "Все сдачи" }).click();
  await expect(page).toHaveURL(`${baseURL}/authoring/submissions`);
  await expect.poll(() => listedIds(page, info)).toEqual([olderAnnaId, olgaId]);
  await expect(counterLink(page, info, 2)).toBeVisible();
  await evidence(page, info, "after-comment");
});

test("list, separate addresses, saved history and filter/page return preserve drafts (#1351)", async ({
  context,
  page,
  baseURL,
}, info) => {
  if (baseURL === undefined) throw new Error("baseURL required");
  await context.addCookies([await authorCookie(baseURL)]);
  await page.goto(`/authoring/submissions?productId=${productId}`);
  await expect(rowLinks(page, info)).toHaveCount(2);
  await expect(page.locator("[data-submission]")).toHaveCount(0);
  await evidence(page, info, "list");
  await rowLinks(page, info).first().press("Enter");
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
  await rowLinks(page, info).first().click();
  await page.getByText("Оставить комментарий ученику", { exact: true }).click();
  await expect(first.getByRole("textbox")).toHaveValue("Черновик первой сдачи");
  await page.getByRole("link", { name: "Все сдачи" }).click();
  await page.getByRole("link", { name: "Более ранние", exact: true }).click();
  await expect(rowLinks(page, info)).toHaveCount(1);
  await rowLinks(page, info).first().click();
  await expect(page.getByRole("link", { name: "Все сдачи" })).toHaveAttribute(
    "href",
    `/authoring/submissions?productId=${productId}&cursor=page-2`,
  );
  await page.getByRole("link", { name: "Все сдачи" }).click();
  await page.getByRole("link", { name: "К новым", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`productId=${productId}$`));
  await expect(rowLinks(page, info)).toHaveCount(2);
  await choose(page, "Глава или задание", "Глава 2. Заявки: все задания");
  await expect(page).toHaveURL(
    new RegExp(`productId=${productId}&chapterId=${chapterId}$`),
  );
  await expect.poll(() => listedIds(page, info)).toEqual([olgaId]);
  await choose(page, "Комментарий автора", "Все сдачи");
  await expect(page).toHaveURL(
    new RegExp(`productId=${productId}&chapterId=${chapterId}&feedback=all$`),
  );
  await expect.poll(() => listedIds(page, info)).toEqual([formId, olgaId]);
  await rowLinks(page, info).first().click();
  await expect(
    page.getByText("Telegram не привязан", { exact: true }),
  ).toBeVisible();
  await page.getByText("Подробный отчёт ученика", { exact: true }).click();
  await expect(
    page.getByText("Проверил сам: заявка создаётся, повтор не создаёт вторую."),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Все сдачи" })).toHaveAttribute(
    "href",
    `/authoring/submissions?productId=${productId}&chapterId=${chapterId}&feedback=all`,
  );
});

test("comment save and failure retain the right draft across route navigation (#1351)", async ({
  context,
  page,
  baseURL,
}, info) => {
  if (baseURL === undefined) throw new Error("baseURL required");
  await context.addCookies([await authorCookie(baseURL)]);
  await page.goto(`/authoring/submissions?feedback=all&submission=${firstId}`);
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
  await expect(page).toHaveURL(/\/authoring\/submissions\?feedback=all$/u);
  release?.();
  await completed;
  await page.unroute("**/api/authoring/product-tasks/feedback");
  await rowLinks(page, info).first().click();
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
  const returnHref = `/authoring/submissions?productId=${productId}&feedback=all&cursor=page-2`;
  for (const id of ["missing", "30000000-0000-4000-8000-000000000999"]) {
    await page.goto(`${returnHref}&submission=${id}`);
    await expect(
      page.getByText("Сдача не найдена", { exact: true }),
    ).toBeVisible();
    await expect(page.locator("[data-submission]")).toHaveCount(0);
    await expect(
      page.getByRole("link", { name: "Все сдачи", exact: true }),
    ).toHaveAttribute("href", returnHref);
    if (id !== "missing") await evidence(page, info, "not-found");
    await page.evaluate(() => {
      document.body.dataset["submissionDocument"] = "retained";
    });
    await page.getByRole("link", { name: "Все сдачи", exact: true }).click();
    await expect(page).toHaveURL(`${baseURL}${returnHref}`);
    expect(
      await page.locator("body").getAttribute("data-submission-document"),
    ).toBe("retained");
  }
});

for (const [state, token, path, text] of [
  ["denied", "submissions-forbidden", "", "Нет доступа к сдачам"],
  ["expired", "submissions-expired", "", "Нужен вход"],
  ["load-error", "submissions-unavailable", "", "Сдачи не загрузились"],
  ["nothing-awaiting", "submissions-empty", "", "Все сдачи прокомментированы"],
  ["empty", "submissions-empty", "?feedback=all", "Сдач пока нет"],
] as const) {
  test(`the live production route displays ${state} without a report (#967)`, async ({
    context,
    page,
    baseURL,
  }, info) => {
    if (baseURL === undefined) throw new Error("baseURL is required");
    await context.addCookies([await authorCookie(baseURL, token)]);
    await page.goto(`/authoring/submissions${path}`);
    await expect(page.getByText(text, { exact: true })).toBeVisible();
    await expect(page.locator("[data-submission]")).toHaveCount(0);
    if (state === "nothing-awaiting")
      await expect(
        page.getByRole("link", { name: "Показать все сдачи" }),
      ).toHaveAttribute("href", "/authoring/submissions?feedback=all");
    await evidence(page, info, state);
  });
}
