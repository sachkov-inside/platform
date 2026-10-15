import { expect, test, type Page, type Request } from "@playwright/test";
import { z } from "zod";
import {
  protectedTaskMarker,
  taskNavigationSlug,
} from "./task-navigation.fixtures.mjs";

const backendPort = process.env["FAKE_BACKEND_PORT"];
if (backendPort === undefined || backendPort === "")
  throw new Error(
    "FAKE_BACKEND_PORT is required by the navigation configuration",
  );
const backend = `http://127.0.0.1:${backendPort}`;
const programme = `/products/${taskNavigationSlug}/programme`;
const code = "navigation-closed-task";
const taskPath = `/products/${taskNavigationSlug}/tasks/${code}`;
const backendTaskPath = `/library/products/${taskNavigationSlug}/tasks/${code}`;

async function taskRequests() {
  const result = await fetch(`${backend}/__requests`);
  const value = z
    .object({ requests: z.array(z.object({ path: z.string() })) })
    .parse(await result.json());
  return value.requests.filter((request) => request.path === backendTaskPath);
}
async function hold(held: boolean) {
  const response = await fetch(`${backend}/__task-navigation-hold`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ hold: held }),
  });
  expect(response.ok).toBe(true);
}
function intentSettled(page: Page): Promise<Request> {
  return new Promise((resolve) => {
    const settled = (request: Request) => {
      const headers = request.headers();
      if (
        new URL(request.url()).pathname !== taskPath ||
        headers["next-router-prefetch"] === undefined ||
        headers["next-router-segment-prefetch"] !== undefined
      )
        return;
      page.off("requestfinished", settled);
      page.off("requestfailed", settled);
      resolve(request);
    };
    page.on("requestfinished", settled);
    page.on("requestfailed", settled);
  });
}

/** RuntimeShell must finish before intent upgrades the task to its public page projection. */
async function installShellProbe(page: Page) {
  await page.addInitScript(() => {
    const shells: string[] = [];
    Reflect.set(window, "__taskPrefetchedShells", shells);
    const nativeFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const headers = new Headers(
        init?.headers ?? (input instanceof Request ? input.headers : undefined),
      );
      const response = nativeFetch(input, init);
      if (headers.get("next-router-prefetch") === "3") {
        void response
          .then(async (answer) => {
            await answer.clone().arrayBuffer();
            if (answer.ok) shells.push(new URL(answer.url).pathname);
          })
          .catch(() => undefined);
      }
      return response;
    };
  });
}

/** A real production session lets the double expose a protected task after navigation, never during prefetch. */
async function memberCookie(baseURL: string) {
  const { wrapSession } = await import("@logto/node");
  return {
    name: "logto_inside-web-navigation",
    url: baseURL,
    httpOnly: true,
    sameSite: "Lax" as const,
    value: await wrapSession(
      {
        accessToken: JSON.stringify({
          [`@${backend}`]: {
            // deterministic-test-allow wall-clock: Logto and the separate production Web process validate this live cookie against real UTC time.
            expiresAt: Math.floor(Date.now() / 1_000) + 3_600,
            scope: "",
            token: "task-navigation-member",
          },
        }),
        idToken: "navigation.id.token",
        refreshToken: "navigation-refresh-token",
      },
      "inside-navigation-logto-cookie-secret-key",
    ),
  };
}

test.afterEach(async () => {
  await hold(false);
});

test("task intent retains the public course frame while personal requirements wait and a repeat open reuses the page", async ({
  page,
  context,
  baseURL,
}, testInfo) => {
  if (baseURL === undefined) throw new Error("baseURL is required");
  await context.addCookies([await memberCookie(baseURL)]);
  await installShellProbe(page);
  await page.goto(programme);
  const taskLink = page.getByRole("link", {
    name: "Закрытое задание",
    exact: true,
  });
  await expect(taskLink).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate((): unknown =>
        Reflect.get(window, "__taskPrefetchedShells"),
      ),
    )
    .toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^\/products\/navigation-tasks\/tasks\/[^/]+$/u),
      ]),
    );
  const before = (await taskRequests()).length;
  const settled = intentSettled(page);
  if (testInfo.project.name === "mobile-chromium")
    await taskLink.dispatchEvent("touchstart");
  else await taskLink.hover();
  const prefetch = await settled;
  const headers = prefetch.headers();
  const replay = await context.request.get(prefetch.url(), {
    headers: Object.fromEntries(
      [
        "rsc",
        "next-router-prefetch",
        "next-router-segment-prefetch",
        "next-router-state-tree",
        "next-url",
      ].flatMap((name) =>
        headers[name] === undefined ? [] : [[name, headers[name]]],
      ),
    ),
  });
  expect(replay.ok()).toBe(true);
  const prefetched = await replay.text();
  expect(prefetched).toContain("Закрытое задание");
  expect(prefetched).not.toContain(protectedTaskMarker);
  expect((await taskRequests()).length).toBe(before);
  await hold(true);
  await taskLink.click();
  await expect.poll(async () => (await taskRequests()).length).toBe(before + 1);
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Закрытое задание",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.locator('[data-product-task-state="pending"]:visible'),
  ).toBeVisible();
  await expect(
    page.locator('[data-product-task-state="loading"]:visible'),
  ).toHaveCount(0);
  await expect(page.locator("[data-course-reading]:visible")).toBeVisible();
  await expect(
    page.getByText(protectedTaskMarker, { exact: true }),
  ).toHaveCount(0);
  if (testInfo.project.name === "mobile-chromium") {
    await expect(
      page.getByRole("navigation", { name: "Навигация по урокам" }),
    ).toBeVisible();
  } else {
    await expect(
      page.getByRole("complementary", { name: "Текущая глава" }),
    ).toBeVisible();
  }
  await hold(false);
  await expect(
    page.locator('[data-product-task-state="open"]:visible'),
  ).toBeVisible();
  await expect(
    page.getByText(protectedTaskMarker, { exact: true }),
  ).toBeVisible();
  await page.evaluate(() => {
    Reflect.set(window, "__taskNavigationDocument", true);
  });
  const course = page.locator("[data-course-reading]:visible");
  const returnLink =
    testInfo.project.name === "mobile-chromium"
      ? course
          .getByRole("navigation", { name: "Хлебные крошки" })
          .getByRole("link")
          .first()
      : course.getByRole("link", { name: "Вся программа", exact: true });
  await returnLink.click();
  await expect(page).toHaveURL(new RegExp(`${programme}$`, "u"));
  const reopened = page.getByRole("link", {
    name: "Закрытое задание",
    exact: true,
  });
  await expect(reopened).toBeVisible();
  const reads = (await taskRequests()).length;
  const rsc: string[] = [];
  page.on("request", (request) => {
    if (
      new URL(request.url()).pathname === taskPath &&
      request.headers()["rsc"] === "1"
    )
      rsc.push(request.url());
  });
  await hold(true);
  await reopened.click();
  await expect(
    page.locator('[data-product-task-state="open"]:visible'),
  ).toBeVisible();
  await expect(
    page.locator('[data-product-task-state="loading"]:visible'),
  ).toHaveCount(0);
  await expect(
    page.locator('[data-product-task-state="pending"]:visible'),
  ).toHaveCount(0);
  expect(
    await page.evaluate(
      () => Reflect.get(window, "__taskNavigationDocument") === true,
    ),
  ).toBe(true);
  expect((await taskRequests()).length).toBe(reads);
  expect(rsc).toEqual([]);
});

test("free tasks open for a guest and unknown or unpublished task codes remain unavailable", async ({
  page,
}) => {
  await page.goto(`/products/${taskNavigationSlug}/tasks/navigation-free-task`);
  await expect(
    page.locator('[data-product-task-state="open"]:visible'),
  ).toBeVisible();
  await expect(
    page.getByText("Открытое условие задания", { exact: true }),
  ).toBeVisible();
  await page.goto(taskPath);
  await expect(
    page.locator('[data-product-task-state="closed"]:visible'),
  ).toBeVisible();
  await expect(
    page.getByText(protectedTaskMarker, { exact: true }),
  ).toHaveCount(0);
  await expect(page.locator("[data-product-task-form]")).toHaveCount(0);
  for (const missing of ["unknown-task", "unpublished-task"]) {
    await page.goto(`/products/${taskNavigationSlug}/tasks/${missing}`);
    await expect(
      page.locator('[data-product-task-state="not-found"]:visible'),
    ).toBeVisible();
    await expect(
      page.getByText(protectedTaskMarker, { exact: true }),
    ).toHaveCount(0);
  }
});

test("free lesson without mode variants reads saved Task state privately", async ({
  page,
  context,
  baseURL,
}, testInfo) => {
  if (baseURL === undefined) throw new Error("baseURL is required");
  const path =
    "/materials/navigation-lesson-1?from=%2Fproducts%2Fnavigation-saved-tasks%2Fprogramme";
  await page.goto(path);
  await expect(
    page.locator('[data-material-reader-state="available"]:visible'),
  ).toBeVisible();
  if (testInfo.project.name === "mobile-chromium")
    await page
      .getByRole("button", { name: "Вся программа", exact: true })
      .click();
  await expect(
    page.locator('[data-task-submitted="true"]:visible'),
  ).toHaveCount(0);
  await context.addCookies([await memberCookie(baseURL)]);
  await page.goto(path);
  await expect(
    page.locator('[data-material-reader-state="available"]:visible'),
  ).toBeVisible();
  if (testInfo.project.name === "mobile-chromium")
    await page
      .getByRole("button", { name: "Вся программа", exact: true })
      .click();
  const title = page.locator('[data-task-submitted="true"]:visible');
  await expect(title).toHaveText("Сохранённое задание");
  await expect(title).toHaveCSS("text-decoration-line", "line-through");
});

test("optional private Task status failure preserves the free lesson and public programme", async ({
  page,
  context,
  baseURL,
}, testInfo) => {
  if (baseURL === undefined) throw new Error("baseURL is required");
  await context.addCookies([await memberCookie(baseURL)]);
  await page.goto(
    "/materials/navigation-lesson-1?from=%2Fproducts%2Fnavigation-saved-tasks-failing%2Fprogramme",
  );
  await expect(page.locator("[data-reader-body]:visible")).toBeVisible();
  if (testInfo.project.name === "mobile-chromium")
    await page
      .getByRole("button", { name: "Вся программа", exact: true })
      .click();
  await expect(
    page.getByRole("link", {
      name: "Задание 1 Сохранённое задание",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.locator('[data-task-submitted="true"]:visible'),
  ).toHaveCount(0);
});
