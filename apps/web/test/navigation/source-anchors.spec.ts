import { expect, test, type Page } from "@playwright/test";

const source = "/materials/navigation-anchor-source";
const target = "/materials/navigation-anchor-target";
const anchor = "как-спроектировать-один-этап";

async function expectHeadingInView(page: Page, fragment = anchor) {
  const heading = page
    .locator(`[data-reader-body] h2[id="${fragment}"]`)
    .filter({ visible: true });
  await expect(heading).toBeVisible();
  await expect(heading).toBeInViewport({ ratio: 1 });
  await expect
    .poll(() =>
      heading.evaluate((node) => {
        let parent = node.parentElement;
        while (parent) {
          if (/auto|scroll/.test(getComputedStyle(parent).overflowY)) break;
          parent = parent.parentElement;
        }
        const scroller = parent ?? document.scrollingElement;
        if (scroller === null) return false;
        const scrollTop = parent?.getBoundingClientRect().top ?? 0;
        const margin = Number.parseFloat(
          getComputedStyle(node).scrollMarginTop,
        );
        const parsedPadding = Number.parseFloat(
          getComputedStyle(scroller).scrollPaddingTop,
        );
        const padding = Number.isFinite(parsedPadding) ? parsedPadding : 0;
        // Native block:start includes the scroll owner's position and target margin.
        return (
          node.getBoundingClientRect().top <= scrollTop + margin + padding + 1
        );
      }),
    )
    .toBe(true);
}

test("cross-page fragment reaches the heading after the destination body arrives", async ({
  page,
  request,
}) => {
  const backendPort = process.env["FAKE_BACKEND_PORT"];
  if (backendPort === undefined) throw new Error("Missing fake backend port");
  const control = `http://127.0.0.1:${backendPort}/__control`;
  await request.post(control, { data: { delayMs: 150 } });
  try {
    await page.goto(source);
    await page
      .getByRole("link", { name: "grill-with-docs", exact: true })
      .click();
    await expectHeadingInView(page);
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            document.documentElement.scrollWidth ===
            document.documentElement.clientWidth,
        ),
      )
      .toBe(true);
  } finally {
    await request.post(control, { data: { delayMs: 0 } });
  }
});

test("same-page links, repeated clicks and legacy fragments keep working", async ({
  page,
}) => {
  await page.goto(target);
  await page
    .getByRole("link", { name: "grill-with-docs", exact: true })
    .click();
  await expectHeadingInView(page);
  await page
    .getByRole("link", { name: "grill-with-docs", exact: true })
    .click();
  await expectHeadingInView(page);
  await page.goto(`${target}#material-section-18`);
  await expectHeadingInView(page);
});

/** Distinct scroll positions the shell passes through after the next same-page link click. */
async function recordScroll(page: Page) {
  await page.evaluate(() => {
    const positions: number[] = [];
    Reflect.set(window, "__scrollPositions", positions);
    document.addEventListener(
      "scroll",
      () => {
        const content = document.querySelector<HTMLElement>(
          "[data-application-content]",
        );
        positions.push(Math.max(window.scrollY, content?.scrollTop ?? 0));
      },
      true,
    );
  });
  return () =>
    page.evaluate(() => {
      const positions: unknown = Reflect.get(window, "__scrollPositions");
      return Array.isArray(positions) ? new Set(positions).size : 0;
    });
}

test("a same-page link scrolls to its section smoothly", async ({ page }) => {
  await page.goto(target);
  await expect(
    page.getByRole("heading", { name: "Целевой материал", exact: true }),
  ).toBeVisible();
  const positions = await recordScroll(page);
  await page
    .getByRole("link", { name: "grill-with-docs", exact: true })
    .click();
  await expectHeadingInView(page);
  // An instant jump lands in one step; an animation passes through intermediate positions.
  expect(await positions()).toBeGreaterThan(2);
  // The same link again emits no hashchange, yet still animates from the top.
  await page.evaluate(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
    document
      .querySelector("[data-application-content]")
      ?.scrollTo({ top: 0, behavior: "instant" });
  });
  await expect(
    page.getByRole("heading", { name: "Целевой материал", exact: true }),
  ).toBeInViewport();
  const repeated = await recordScroll(page);
  await page
    .getByRole("link", { name: "grill-with-docs", exact: true })
    .click();
  await expectHeadingInView(page);
  expect(await repeated()).toBeGreaterThan(2);
});

test("reduced motion keeps the same-page jump instant", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(target);
  await expect(
    page.getByRole("heading", { name: "Целевой материал", exact: true }),
  ).toBeVisible();
  const positions = await recordScroll(page);
  await page
    .getByRole("link", { name: "grill-with-docs", exact: true })
    .click();
  await expectHeadingInView(page);
  expect(await positions()).toBeLessThanOrEqual(1);
});

/** The shell position, whichever root scrolls at this width. */
function shellPosition(page: Page) {
  return page.evaluate(() =>
    Math.max(
      window.scrollY,
      document.querySelector<HTMLElement>("[data-application-content]")
        ?.scrollTop ?? 0,
    ),
  );
}

test("a video moment fragment keeps the reader's place", async ({ page }) => {
  await page.goto(`${target}#${anchor}`);
  await expectHeadingInView(page);
  const before = await shellPosition(page);
  expect(before).toBeGreaterThan(0);
  // Video chapters link to `#t=<seconds>`: the player seeks, the page stays where it is.
  await page
    .getByRole("link", { name: "Момент видео", exact: true })
    .evaluate((link) => {
      link.scrollIntoView({ block: "nearest", behavior: "instant" });
    });
  const linked = await shellPosition(page);
  await page.getByRole("link", { name: "Момент видео", exact: true }).click();
  await expect(page).toHaveURL(/#t=90$/u);
  await page.evaluate(() => {
    window.location.hash = "t=120";
  });
  await expect(page).toHaveURL(/#t=120$/u);
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  expect(await shellPosition(page)).toBe(linked);
});

test("a video moment on another page opens that page from the start", async ({
  page,
}) => {
  const programme = "/products/reference-course/programme";
  await page.goto(
    `/materials/reference-lesson-5?from=${encodeURIComponent(programme)}`,
  );
  await expect(
    page.getByRole("heading", { name: "Урок 5", exact: true }),
  ).toBeVisible();
  await page.evaluate(() => {
    const root = document.querySelector<HTMLElement>(
      "[data-application-content]",
    );
    if (root !== null && root.scrollHeight > root.clientHeight)
      root.scrollTop = 600;
    else window.scrollTo(0, 600);
  });
  await expect.poll(() => shellPosition(page)).toBeGreaterThan(0);
  // A client transition from a scrolled lesson; clicking without scrolling keeps that position.
  await page
    .locator("[data-reader-body]")
    .filter({ visible: true })
    .getByRole("link", { name: "момент урока 6", exact: true })
    .evaluate((link) => {
      if (link instanceof HTMLElement) link.click();
    });
  await expect(
    page.getByRole("heading", { name: "Урок 6", exact: true }),
  ).toBeVisible();
  await expect(page).toHaveURL(/#t=90$/u);
  await expect.poll(() => shellPosition(page)).toBe(0);
});

test("a repeated fragment selects the visible body instead of a retained hidden page", async ({
  page,
}) => {
  await page.goto(`${target}#${anchor}`);
  await expectHeadingInView(page);
  // Retained Activity pages exist after client activation, not during the initial static shell.
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          Reflect.get(window.history.state ?? {}, "insideReader") !== undefined,
      ),
    )
    .toBe(true);
  await page.evaluate((id) => {
    const retained = document.createElement("section");
    retained.hidden = true;
    const heading = document.createElement("h2");
    heading.id = id;
    heading.textContent = "Retained page heading";
    retained.append(heading);
    document.body.prepend(retained);
  }, anchor);
  await page
    .getByRole("link", { name: "grill-with-docs", exact: true })
    .click();
  await expectHeadingInView(page);
});

test("an unknown fragment returns the document and desktop container to the start", async ({
  page,
}) => {
  await page.goto(`${target}#${anchor}`);
  await expectHeadingInView(page);
  await page.getByRole("link", { name: "Нет раздела", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Целевой материал", exact: true }),
  ).toBeInViewport();
  await expect
    .poll(() =>
      page.evaluate(() => ({
        document: window.scrollY,
        container: document.querySelector<HTMLElement>(
          "[data-application-content]",
        )?.scrollTop,
      })),
    )
    .toEqual({ document: 0, container: 0 });
  await page.goto(source);
  await page.getByRole("link", { name: "Нет раздела", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Целевой материал", exact: true }),
  ).toBeInViewport();
});

test("a Content source heading keeps native repeated links and unique IDs", async ({
  page,
}) => {
  await page.goto("/materials/navigation-anchor-content");
  const link = page.getByRole("link", { name: "grill-with-docs", exact: true });
  await link.click();
  await expectHeadingInView(page, "content");
  await link.click();
  await expectHeadingInView(page, "content");
  await expect(page.locator('[id="content"]')).toHaveCount(1);
});
