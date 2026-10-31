import AxeBuilder from "@axe-core/playwright";
import {
  expect,
  test as base,
  type APIRequestContext,
  type BrowserContext,
} from "@playwright/test";
import { z } from "zod";

declare global {
  interface Window {
    readerTitleObservations: { title: string; head: boolean }[];
  }
}
import { expectLinearProgrammeReturn } from "../support/linear-programme";
import { expectReaderReadyForAudit } from "../support/reader-audit-readiness";

/** The fake backend port is assigned by the navigation config before workers start. */
function fakeBackendUrl() {
  return `http://127.0.0.1:${process.env["FAKE_BACKEND_PORT"] ?? ""}`;
}

const fixtureSchema = z.strictObject({
  scope: z.uuid(),
  productSlug: z.string().regex(/^reader-title-[0-9a-f-]+$/u),
  materialSlugs: z.tuple([z.string(), z.string()]),
});
type ReaderTitleFixture = z.infer<typeof fixtureSchema>;
async function provideReaderTitleFixture(
  request: APIRequestContext,
  layout: "course" | "linear",
  provideFixture: (fixture: ReaderTitleFixture) => Promise<void>,
) {
  const backend = fakeBackendUrl();
  const response = await request.post(
    `${backend}/__reader-title-fixtures?layout=${layout}`,
  );
  const body: unknown = await response.json();
  const { scope } = z.object({ scope: z.uuid() }).parse(body);
  try {
    expect(response.status()).toBe(201);
    await provideFixture(fixtureSchema.parse(body));
  } finally {
    const deleted = await request.delete(
      `${backend}/__reader-title-fixtures/${scope}`,
    );
    expect(deleted.status()).toBe(200);
    expect(await deleted.json()).toEqual({ deleted: true });
  }
}
const test = base.extend<{
  readerTitleFixture: ReaderTitleFixture;
  linearReaderTitleFixture: ReaderTitleFixture;
}>({
  readerTitleFixture: async ({ request }, provideFixture) => {
    await provideReaderTitleFixture(request, "course", provideFixture);
  },
  linearReaderTitleFixture: async ({ request }, provideFixture) => {
    await provideReaderTitleFixture(request, "linear", provideFixture);
  },
});

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
  const backend = fakeBackendUrl();
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

test("Reader audit uses the identity of the existing programme after session setup", async ({
  page,
  context,
  baseURL,
  readerTitleFixture,
}) => {
  await page.goto(`/products/${readerTitleFixture.productSlug}/programme`);
  await expect(
    page
      .getByRole("button", { name: "Войти через Telegram", exact: true })
      .first(),
  ).toBeVisible();
  await signInReader(context, baseURL);
  // Session cookies change outside this page; reload its guest auth snapshot before client navigation.
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Аккаунт", exact: true }),
  ).toBeVisible();
  const programme = page.locator(
    `[data-product-programme="${readerTitleFixture.productSlug}"]:visible`,
  );
  await programme
    .getByRole("link", { name: "Первый заголовок читателя", exact: true })
    .click();
  await expect(
    page.locator('[data-material-reader-state="available"]:visible'),
  ).toBeInViewport();
  await expectReaderReadyForAudit(
    page,
    "Первый заголовок читателя · Sachkov Dev",
  );
  const committedCount = await page
    .locator('[data-material-reader-state="available"]:visible')
    .evaluate(
      (reader) => /Открытий материала: (\d+)/u.exec(reader.textContent)?.[1],
    );
  expect(committedCount).toBe("1");
  const accessibility = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(
    accessibility.violations.filter(
      ({ impact }) => impact === "serious" || impact === "critical",
    ),
  ).toEqual([]);
  await page
    .getByRole("navigation", { name: "Действия материала", exact: true })
    .getByRole("link", { name: "Назад", exact: true })
    .click();
  await expect(programme).toHaveCount(1);
  await expect(
    programme.getByRole("link", {
      name: "Первый заголовок читателя",
      exact: true,
    }),
  ).toBeInViewport();
});

const linearReturnHref = "/products/linear/programme?page=1&at=lesson";

/** Streaming shows the pending frame first; the Reader waits in a hidden segment until React swaps them. */
function linearReturnDocument(revealed: boolean) {
  const actions = `<nav aria-label="Действия материала"><a href="${linearReturnHref}">Назад</a></nav><nav aria-label="Действия в конце материала"><a href="${linearReturnHref}">Назад</a></nav>`;
  const reader = `<div data-material-reader-state="available">${actions}<nav aria-label="Уроки продукта"><a href="${linearReturnHref}" aria-label="Программа, урок 1">1</a></nav></div>`;
  const head = `<meta name="viewport" content="width=device-width, initial-scale=1"><style>@media (min-width: 768px) { [aria-label="Уроки продукта"] { display: none; } }</style>`;
  return revealed
    ? `<html><head>${head}</head><body><main>${reader}</main></body></html>`
    : `<html><head>${head}</head><body><main><div data-material-reader-state="pending">${actions}</div></main><div hidden>${reader}</div></body></html>`;
}
test("linear programme return rejects the Reader pending frame", async ({
  page,
}, testInfo) => {
  await page.setContent(linearReturnDocument(false));
  await expect(
    expectLinearProgrammeReturn(
      page,
      testInfo.project.name === "mobile-chromium",
      linearReturnHref,
    ),
  ).rejects.toThrow(/data-material-reader-state="available"/u);
});
test("linear programme return accepts the revealed Reader", async ({
  page,
}, testInfo) => {
  await page.setContent(linearReturnDocument(true));
  const action = await expectLinearProgrammeReturn(
    page,
    testInfo.project.name === "mobile-chromium",
    linearReturnHref,
  );
  await expect(action).toHaveAttribute("href", linearReturnHref);
});

test("streamed Reader replaces the pending frame and its return actions", async ({
  page,
  context,
  baseURL,
  request,
  linearReaderTitleFixture,
}, testInfo) => {
  await signInReader(context, baseURL);
  const backend = fakeBackendUrl();
  const holdPersonalRead = async (held: boolean) => {
    const response = await request.post(
      `${backend}/__reader-title-fixtures/${linearReaderTitleFixture.scope}/personal-read-hold`,
      { data: { held } },
    );
    expect(response.status()).toBe(200);
  };
  const [slug] = linearReaderTitleFixture.materialSlugs;
  const from = `/products/${linearReaderTitleFixture.productSlug}/programme?page=1&at=${slug}`;
  await holdPersonalRead(true);
  try {
    // The held signed-in read keeps the document stream open, so navigation ends at commit.
    await page.goto(`/materials/${slug}?from=${encodeURIComponent(from)}`, {
      waitUntil: "commit",
    });
    const loadingReturn = page
      .locator('[data-material-reader-state="pending"]:visible')
      .getByRole("navigation", { name: "Действия материала", exact: true })
      .getByRole("link", { name: "Назад", exact: true });
    // The pending frame repeats the return actions of the Reader that later replaces it (#1908).
    await expect(loadingReturn).toHaveAttribute("href", from);
    const loadingNode = await loadingReturn.elementHandle();
    const ready = expectLinearProgrammeReturn(
      page,
      testInfo.project.name === "mobile-chromium",
      from,
    ).then(
      () => undefined,
      (error: unknown) =>
        error instanceof Error
          ? error
          : new Error("Linear programme return failed", { cause: error }),
    );
    await holdPersonalRead(false);
    const failure = await ready;
    if (failure !== undefined) throw failure;
    // React has removed the pending frame together with its return actions.
    expect(await loadingNode.evaluate((node) => node.isConnected)).toBe(false);
  } finally {
    await holdPersonalRead(false);
  }
});

test("Reader open refresh settles cold metadata and preserves an existing HEAD title", async ({
  page,
  context,
  baseURL,
  readerTitleFixture,
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
  for (const [index, slug] of readerTitleFixture.materialSlugs.entries()) {
    const ordinal = index + 1;
    const path = `/materials/${slug}`;
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
          `${path}?from=${encodeURIComponent(`/products/${readerTitleFixture.productSlug}/programme`)}`,
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
        const committedCount = await page
          .locator('[data-material-reader-state="available"]:visible')
          .evaluate(
            (reader) =>
              /Открытий материала: (\d+)/u.exec(reader.textContent)?.[1],
          );
        expect(committedCount).toBe("1");
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
  readerTitleFixture,
}) => {
  await signInReader(context, baseURL);
  const slug = readerTitleFixture.materialSlugs[0];
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
      `/products/${readerTitleFixture.productSlug}/programme?page=1&at=${slug}`,
    );
    const programme = page.locator(
      `[data-product-programme="${readerTitleFixture.productSlug}"]:visible`,
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
