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
