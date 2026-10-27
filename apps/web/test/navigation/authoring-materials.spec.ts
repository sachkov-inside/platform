import AxeBuilder from "@axe-core/playwright";
import {
  expect,
  test,
  type APIRequestContext,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { z } from "zod";

const backendPort = process.env["FAKE_BACKEND_PORT"];
if (backendPort === undefined) throw new Error("FAKE_BACKEND_PORT is required");
const backend = `http://127.0.0.1:${backendPort}`;
const reviewId = "97000000-0000-4000-8000-000000000001";
const reviewTitle = "Ревью кода с агентом";
/** The Topic of `authoring-materials-backend.mjs` that holds the two named Materials. */
const agentsTopic = {
  id: "97000000-0000-4000-8000-000000000101",
  name: "Разработка с агентами",
} as const;

async function signIn(
  context: BrowserContext,
  baseURL: string | undefined,
  token = "materials-author",
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
      idToken: "materials.id.token",
      refreshToken: "materials-refresh-token",
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

/** The visible row of a Material: a table row from 48rem, a list item below. */
function materialRow(page: Page, title: string) {
  return page
    .getByRole("main")
    .locator("tr:visible, li.admin-list-item:visible")
    .filter({ has: page.getByRole("link", { name: title, exact: true }) });
}

async function choose(page: Page, filter: string, option: string) {
  await page
    .getByRole("main")
    .getByRole("combobox", { name: filter, exact: true })
    .click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

/** What the fake backend received for the Materials list, in arrival order. */
async function listReads(request: APIRequestContext) {
  const response = await request.get(`${backend}/__requests`);
  expect(response.ok()).toBe(true);
  const { requests } = z
    .object({
      requests: z.array(
        z.object({ method: z.string(), path: z.string() }).loose(),
      ),
    })
    .parse(await response.json());
  return requests
    .map((entry) => ({
      method: entry.method,
      url: new URL(entry.path, "http://backend.test"),
    }))
    .filter(({ url }) => url.pathname.startsWith("/authoring/materials"));
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

test.beforeEach(async ({ request }) => {
  expect(
    (
      await request.post(`${backend}/__control`, {
        data: { delayMs: 0, unavailable: false },
      })
    ).ok(),
  ).toBe(true);
  expect(
    (await request.post(`${backend}/__authoring-materials/reset`)).ok(),
  ).toBe(true);
  expect((await request.delete(`${backend}/__requests`)).ok()).toBe(true);
});

test("Materials filters live in the address, reach the server and survive reload and return", async ({
  baseURL,
  context,
  page,
  request,
}) => {
  await signIn(context, baseURL);
  await page.goto("/authoring/materials");
  await expect(
    page.getByRole("heading", { level: 1, name: "Материалы" }),
  ).toBeVisible();
  await expect(page.getByText("24 материала", { exact: true })).toBeVisible();
  await expect(materialRow(page, reviewTitle)).toBeVisible();
  await expectAccessibleWithoutOverflow(page);

  await choose(page, "Тема", agentsTopic.name);
  await expect(page).toHaveURL(`/authoring/materials?topic=${agentsTopic.id}`);
  await choose(page, "Формат", "Видео");
  await expect(page).toHaveURL(
    `/authoring/materials?topic=${agentsTopic.id}&format=video`,
  );
  await expect(page.getByText("1 материал", { exact: true })).toBeVisible();
  await expect(materialRow(page, reviewTitle)).toBeVisible();
  await expect(materialRow(page, "Субагенты")).toHaveCount(0);
  const chips = page
    .getByRole("main")
    .getByRole("list", { name: "Применённые фильтры" });
  await expect(chips.getByRole("listitem")).toHaveText([
    agentsTopic.name,
    "Видео",
  ]);
  const reads = await listReads(request);
  expect(
    reads.some(
      ({ method, url }) =>
        method === "GET" &&
        url.pathname === "/authoring/materials" &&
        url.searchParams.get("topicId") === agentsTopic.id &&
        url.searchParams.get("format") === "video",
    ),
  ).toBe(true);
  await expectAccessibleWithoutOverflow(page);

  await page.reload();
  await expect(materialRow(page, reviewTitle)).toBeVisible();
  await expect(
    page.getByRole("main").getByRole("combobox", { name: "Тема" }),
  ).toHaveText(agentsTopic.name);
  await expect(
    page.getByRole("main").getByRole("combobox", { name: "Формат" }),
  ).toHaveText("Видео");

  // A click on the row outside its link opens the editor with the filtered list as the return.
  const listAddress = `/authoring/materials?topic=${agentsTopic.id}&format=video`;
  await materialRow(page, reviewTitle)
    .getByText(/Изменён|20 окт\. 2026/u)
    .click();
  await expect(page).toHaveURL(
    `/authoring/materials/${reviewId}?from=${encodeURIComponent(listAddress)}`,
  );
  await page.goBack();
  await expect(page).toHaveURL(listAddress);
  await expect(materialRow(page, reviewTitle)).toBeVisible();
  await expect(chips.getByRole("listitem")).toHaveCount(2);

  const search = page.getByRole("main").getByRole("searchbox", {
    name: "Поиск по названию, описанию или адресу",
  });
  await page
    .getByRole("main")
    .getByRole("button", { name: "Сбросить" })
    .click();
  await expect(page).toHaveURL("/authoring/materials");
  await expect(page.getByText("24 материала", { exact: true })).toBeVisible();
  await search.fill("Субагенты");
  await expect(page).toHaveURL(/\/authoring\/materials\?search=/u);
  await expect(materialRow(page, "Субагенты")).toBeVisible();
  await expect(materialRow(page, reviewTitle)).toHaveCount(0);
  expect(
    (await listReads(request)).some(
      ({ url }) =>
        url.pathname === "/authoring/materials" &&
        url.searchParams.get("search") === "Субагенты",
    ),
  ).toBe(true);
});

test("the row menu opens Preview and publishes with the badge following the receipt", async ({
  baseURL,
  context,
  page,
  request,
}) => {
  await signIn(context, baseURL);
  await page.goto(
    `/authoring/materials?search=${encodeURIComponent(reviewTitle)}`,
  );
  const row = materialRow(page, reviewTitle);
  await expect(
    row.getByText("Снят с публикации", { exact: true }),
  ).toBeVisible();
  const menuButton = row.getByRole("button", {
    name: `Действия с «${reviewTitle}»`,
  });

  await menuButton.click();
  const menu = page.getByRole("menu");
  await expect(
    menu.getByRole("menuitem", { name: "Предпросмотр" }),
  ).toHaveAttribute(
    "href",
    `/authoring/materials/${reviewId}/preview?from=${encodeURIComponent(
      `/authoring/materials?search=${encodeURIComponent(reviewTitle).replaceAll("%20", "+")}`,
    )}`,
  );
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);

  await menuButton.click();
  await menu.getByRole("menuitem", { name: "Опубликовать" }).click();
  await expect(row.getByText("Опубликован", { exact: true })).toBeVisible();
  const reads = await listReads(request);
  expect(
    reads.filter(
      ({ method, url }) =>
        method === "PATCH" &&
        url.pathname === `/authoring/materials/${reviewId}/publication`,
    ),
  ).toHaveLength(1);

  // The re-read list carries the new version: the next command from the menu is the reverse one.
  await menuButton.click();
  await expect(
    menu.getByRole("menuitem", { name: "Снять с публикации" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  // The open menu hides the rest of the page from assistive technology until it closes.
  await expect(menu).toHaveCount(0);
  await expect(
    page.locator("[data-authoring-materials-frame] [data-aria-hidden]"),
  ).toHaveCount(0);
  await expectAccessibleWithoutOverflow(page);
});

test("an account without the right to manage Materials gets a refusal with retry", async ({
  baseURL,
  context,
  page,
}) => {
  await signIn(context, baseURL, "materials-forbidden");
  await page.goto("/authoring/materials");
  const main = page.getByRole("main");
  await expect(
    main.getByRole("heading", { name: "Нет доступа к материалам" }),
  ).toBeVisible();
  await expect(main.getByRole("button", { name: "Повторить" })).toBeVisible();
  await expectAccessibleWithoutOverflow(page);
});
