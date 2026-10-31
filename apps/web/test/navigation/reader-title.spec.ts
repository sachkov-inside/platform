import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext } from "@playwright/test";
import { z } from "zod";

declare global {
  interface Window {
    readerTitleObservations: { title: string; head: boolean }[];
  }
}
import { expectReaderReadyForAudit } from "../support/reader-audit-readiness";

const title = "Первый бесплатный урок · Sachkov Dev";

function settledDocument(head: string, body: string, state = "saved") {
  return `<html><head>${head}</head><body><div data-route-refresh-pending="false"><div data-material-open-state="${state}"><main data-material-reader-state="available">Reader</main></div></div>${body}</body></html>`;
}
for (const state of ["wrong-title", "missing-title", "pending-open"] as const) {
  test(`Reader audit readiness rejects ${state}`, async ({ page }) => {
    await page.setContent(
      settledDocument(
        state === "missing-title"
          ? ""
          : `<title>${state === "wrong-title" ? "Другой материал · Sachkov Dev" : title}</title>`,
        "",
        state === "pending-open" ? "pending" : "saved",
      ),
    );
    let audited = false;
    await expect(
      (async () => {
        await expectReaderReadyForAudit(page, title);
        audited = true;
        await new AxeBuilder({ page }).withRules(["document-title"]).analyze();
      })(),
    ).rejects.toThrow();
    expect(audited).toBe(false);
  });
}
test("settled Reader accepts a valid streamed BODY title", async ({ page }) => {
  await page.setContent(settledDocument("", `<title>${title}</title>`));
  await expectReaderReadyForAudit(page, title);
  const accessibility = await new AxeBuilder({ page })
    .withRules(["document-title"])
    .analyze();
  expect(accessibility.violations).toEqual([]);
});
async function signInReader(
  context: BrowserContext,
  baseURL: string | undefined,
) {
  if (baseURL === undefined) throw new Error("Web origin required");
  const backend = `http://127.0.0.1:${process.env["FAKE_BACKEND_PORT"] ?? ""}`;
  const { wrapSession } = await import("@logto/node");
  await context.addCookies([
    {
      name: "logto_inside-web-navigation",
      url: baseURL,
      httpOnly: true,
      sameSite: "Lax",
      value: await wrapSession(
        {
          accessToken: JSON.stringify({
            [`@${backend}`]: {
              // deterministic-test-allow wall-clock: The Web process and Logto SDK validate this synthetic session against their live clock.
              expiresAt: Math.floor(Date.now() / 1000) + 3600,
              scope: "",
              token: "navigation-member-token",
            },
          }),
          idToken: "navigation.id.token",
          refreshToken: "navigation-refresh-token",
        },
        "inside-navigation-logto-cookie-secret-key",
      ),
    },
  ]);
}

test("Reader open refresh settles cold metadata and preserves an existing HEAD title", async ({
  page,
  context,
  baseURL,
}) => {
  await signInReader(context, baseURL);
  await page.addInitScript(() => {
    window.readerTitleObservations = [];
    new MutationObserver(() => {
      const value = {
        title: document.title,
        head: document.head.querySelector("title") !== null,
      };
      const previous = window.readerTitleObservations.at(-1);
      if (previous?.title !== value.title || previous.head !== value.head)
        window.readerTitleObservations.push(value);
    }).observe(document, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  });
  const variant =
    test.info().project.name === "mobile-chromium" ? "mobile" : "desktop";
  for (const ordinal of [1, 2]) {
    const path = `/materials/reader-title-${variant}-${String(ordinal)}`;
    const expected =
      ordinal === 1
        ? "Первый заголовок читателя · Sachkov Dev"
        : "Второй заголовок читателя · Sachkov Dev";
    let openSaved = false;
    const openHeld = Promise.withResolvers<undefined>();
    const releaseOpen = Promise.withResolvers<undefined>();
    const refreshHeld = Promise.withResolvers<undefined>();
    const releaseRefresh = Promise.withResolvers<undefined>();
    await page.route("**/api/reading-progress/open", async (route) => {
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      z.object({ kind: z.literal("saved") }).parse(await response.json());
      openSaved = true;
      openHeld.resolve(undefined);
      await releaseOpen.promise;
      await route.fulfill({ response });
    });
    await page.route(`**${path}?*`, async (route) => {
      const headers = route.request().headers();
      if (
        headers["rsc"] !== "1" ||
        headers["next-router-prefetch"] !== undefined ||
        !openSaved
      ) {
        await route.continue();
        return;
      }
      const response = await route.fetch();
      refreshHeld.resolve(undefined);
      await releaseRefresh.promise;
      await route.fulfill({ response });
    });
    try {
      if (ordinal === 1)
        await page.goto(
          `${path}?from=${encodeURIComponent(`/products/reader-title-${variant}/programme`)}`,
        );
      else
        await page
          .getByRole("link", { name: "Следующий материал", exact: true })
          .click();
      await openHeld.promise;
      // Both prior-state barriers are true before the saved open refreshes this Reader.
      await expect(page).toHaveTitle(expected);
      await expect(
        page.locator(ordinal === 1 ? "body title" : "head > title"),
      ).toHaveJSProperty("textContent", expected);
      await page.evaluate(() => {
        window.readerTitleObservations = [
          {
            title: document.title,
            head: document.head.querySelector("title") !== null,
          },
        ];
      });
      let audited = false;
      const audit = (async () => {
        await expectReaderReadyForAudit(page, expected);
        audited = true;
        const committedBody = await page
          .locator('[data-material-reader-state="available"]:visible')
          .evaluate((reader) =>
            reader.textContent.includes("Открытий материала: 1"),
          );
        expect(committedBody).toBe(true);
        const accessibility = await new AxeBuilder({ page })
          .withRules(["document-title"])
          .analyze();
        expect(accessibility.violations).toEqual([]);
      })().then(
        () => undefined,
        (error: unknown) =>
          error instanceof Error
            ? error
            : new Error("Reader audit failed", { cause: error }),
      );
      releaseOpen.resolve(undefined);
      await refreshHeld.promise;
      await expect(
        page.locator("[data-route-refresh-pending]").filter({
          has: page.locator('[data-material-reader-state="available"]:visible'),
        }),
      ).toHaveAttribute("data-route-refresh-pending", "true");
      await expect(
        page.locator("[data-material-open-state]").filter({
          has: page.locator('[data-material-reader-state="available"]:visible'),
        }),
      ).toHaveAttribute("data-material-open-state", "saved");
      expect(audited).toBe(false);
      releaseRefresh.resolve(undefined);
      const auditError = await audit;
      if (auditError !== undefined) throw auditError;
      // Independent oracle only after the shared helper and immediate axe audit.
      await expect(
        page
          .locator('[data-material-reader-state="available"]:visible')
          .getByText("Открытий материала: 1", { exact: true }),
      ).toBeVisible();
      const observations = await page.evaluate(
        () => window.readerTitleObservations,
      );
      await test.info().attach(`title-transitions-${String(ordinal)}`, {
        body: JSON.stringify(observations),
        contentType: "application/json",
      });
    } finally {
      releaseOpen.resolve(undefined);
      releaseRefresh.resolve(undefined);
      await page.unrouteAll({ behavior: "wait" });
    }
  }
});

test("late saved open survives Activity hide and return for the same Reader", async ({
  page,
  context,
  baseURL,
}) => {
  await signInReader(context, baseURL);
  const variant =
    test.info().project.name === "mobile-chromium" ? "mobile" : "desktop";
  const slug = `reader-title-${variant}-1`;
  const openHeld = Promise.withResolvers<undefined>();
  const releaseOpen = Promise.withResolvers<undefined>();
  let opens = 0;
  await page.route("**/api/reading-progress/open", async (route) => {
    opens++;
    const response = await route.fetch();
    z.object({ kind: z.literal("saved") }).parse(await response.json());
    openHeld.resolve(undefined);
    await releaseOpen.promise;
    await route.fulfill({ response });
  });
  try {
    await page.goto(
      `/products/reader-title-${variant}/programme?page=1&at=${slug}`,
    );
    const programme = page.locator(
      `[data-product-programme="reader-title-${variant}"]:visible`,
    );
    await programme.locator(`a[href*='/materials/${slug}']`).first().click();
    await openHeld.promise;
    const readerUrl = page.url();
    await page
      .getByRole("navigation", { name: "Действия материала", exact: true })
      .getByRole("link", { name: "Назад", exact: true })
      .click();
    await expect(programme).toBeVisible();
    await expect(
      page.locator('[data-material-reader-state="available"]:visible'),
    ).toHaveCount(0);
    const response = page.waitForResponse("**/api/reading-progress/open");
    releaseOpen.resolve(undefined);
    await (await response).finished();
    await programme.locator(`a[href*='/materials/${slug}']`).first().click();
    await expect(page).toHaveURL(readerUrl);
    const current = page.locator("[data-material-open-state]").filter({
      has: page.locator('[data-material-reader-state="available"]:visible'),
    });
    await expect(current).toHaveAttribute("data-material-open-state", "saved");
    expect(opens).toBe(1);
  } finally {
    releaseOpen.resolve(undefined);
    await page.unrouteAll({ behavior: "wait" });
  }
});
