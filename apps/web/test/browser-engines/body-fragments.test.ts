import { expect as ui, type Browser } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { z } from "zod";
import { beforeAll, afterAll, test } from "vitest";
import { createOwnedBrowserFixture } from "../support/owned-browser-fixture";

const fixture = createOwnedBrowserFixture("body-fragments");
let browsers: ReadonlyMap<string, Browser> = new Map();
let url = "";
beforeAll(async () => {
  const started = await fixture.start();
  browsers = started.browsers;
  url = started.url;
}, 30_000);
afterAll(() => fixture.close(), 30_000);

for (const engine of ["chromium", "webkit"]) {
  test(`${engine}: the repeated section link preserves a smooth scroll`, async () => {
    const browser = browsers.get(engine);
    if (browser === undefined) throw new Error("Missing body fragment browser");
    const page = await browser.newPage({
      reducedMotion: "no-preference",
      viewport: { width: 390, height: 844 },
    });
    try {
      await page.goto(url);
      const target = page.getByRole("heading", {
        name: "Target section",
        exact: true,
      });
      const link = page.getByRole("link", { name: "Read target", exact: true });
      const settled = () =>
        target.evaluate(
          (node) =>
            node.getBoundingClientRect().top <=
            Number.parseFloat(getComputedStyle(node).scrollMarginTop) + 1,
        );
      await link.click();
      await ui(target).toBeInViewport({ ratio: 1 });
      await ui.poll(settled).toBe(true);
      await page.evaluate(() => {
        window.scrollTo({ top: 0, behavior: "instant" });
      });
      await ui(link).toBeInViewport();
      await page.evaluate(() => {
        const positions = new Set<number>();
        document.addEventListener(
          "scroll",
          () => {
            positions.add(window.scrollY);
          },
          true,
        );
        Object.defineProperty(window, "fragmentScrollPositions", {
          get: () => positions.size,
        });
      });
      await link.click();
      await ui(target).toBeInViewport({ ratio: 1 });
      await ui.poll(settled).toBe(true);
      await ui
        .poll(() =>
          page.evaluate(() =>
            Number(Reflect.get(window, "fragmentScrollPositions")),
          ),
        )
        .toBeGreaterThan(2);
    } finally {
      await page.close();
    }
  }, 30_000);

  test(`${engine}: native same-page and repeated material links reach their section`, async () => {
    const browser = browsers.get(engine);
    if (browser === undefined) throw new Error("Missing body fragment browser");
    const page = await browser.newPage({
      reducedMotion: "reduce",
      viewport: { width: 390, height: 844 },
    });
    try {
      await page.goto(url);
      const target = page.getByRole("heading", {
        name: "Target section",
        exact: true,
      });
      const link = page.getByRole("link", { name: "Read target", exact: true });
      await ui(link).toBeVisible();
      await link.click();
      await ui(target).toBeInViewport();
      await ui(page).toHaveURL(/#target-section$/u);
      await ui(page.locator("body")).toBeFocused();
      const firstHistoryLength = await page.evaluate(() => history.length);
      await link.click();
      await ui(target).toBeInViewport();
      await ui(page.locator("body")).toBeFocused();
      await ui
        .poll(() => page.evaluate(() => history.length))
        .toBe(firstHistoryLength);
    } finally {
      await page.close();
    }
  }, 30_000);

  test(`${engine}: repeated fragment chooses the visible material without waiting for an animation frame`, async () => {
    const browser = browsers.get(engine);
    if (browser === undefined) throw new Error("Missing body fragment browser");
    const page = await browser.newPage({
      reducedMotion: "reduce",
      viewport: { width: 390, height: 844 },
    });
    try {
      await page.goto(url);
      const target = page.getByRole("heading", {
        name: "Target section",
        exact: true,
      });
      const link = page.getByRole("link", { name: "Read target", exact: true });
      await link.click();
      await ui(target).toBeInViewport();
      await page.clock.install({ time: new Date("2030-01-01T00:00:00.000Z") });
      await page.clock.pauseAt(new Date("2030-01-01T00:00:01.000Z"));
      await page.evaluate(() => {
        const retained = document.createElement("section");
        retained.hidden = true;
        const heading = document.createElement("h2");
        heading.id = "target-section";
        heading.textContent = "Hidden retained section";
        retained.append(heading);
        document.body.prepend(retained);
        window.scrollTo({ top: 0, behavior: "instant" });
      });
      await ui(link).toBeInViewport();
      await link.click();
      await ui(target).toBeInViewport();
      await ui(page).toHaveURL(/#target-section$/u);
    } finally {
      await page.close();
    }
  }, 30_000);

  test(`${engine}: the retained material releases fragment listeners while hidden or removed`, async () => {
    const browser = browsers.get(engine);
    if (browser === undefined) throw new Error("Missing body fragment browser");
    const page = await browser.newPage({
      reducedMotion: "reduce",
      viewport: { width: 390, height: 844 },
    });
    try {
      await page.addInitScript(() => {
        const handlers = new Set<EventListenerOrEventListenerObject>();
        const add = window.addEventListener.bind(window);
        const remove = window.removeEventListener.bind(window);
        window.addEventListener = (
          ...args: Parameters<typeof window.addEventListener>
        ) => {
          if (args[0] === "hashchange") handlers.add(args[1]);
          add(...args);
        };
        window.removeEventListener = (
          ...args: Parameters<typeof window.removeEventListener>
        ) => {
          if (args[0] === "hashchange") handlers.delete(args[1]);
          remove(...args);
        };
        Object.defineProperty(window, "materialFragmentListeners", {
          get: () => handlers.size,
        });
      });
      await page.goto(url);
      const count = () =>
        page.evaluate(() =>
          Number(Reflect.get(window, "materialFragmentListeners")),
        );
      const target = page.getByRole("heading", {
        name: "Target section",
        exact: true,
      });
      await ui.poll(count).toBe(1);
      await page
        .getByRole("link", { name: "Read target", exact: true })
        .click();
      await ui(target).toBeInViewport();
      await page
        .getByRole("button", { name: "Hide body", exact: true })
        .click();
      await ui(page.locator("[data-reader-body]")).toBeHidden();
      await ui.poll(count).toBe(0);
      await page
        .getByRole("button", { name: "Show body", exact: true })
        .click();
      await ui.poll(count).toBe(1);
      await ui(target).toBeInViewport();
      await page
        .getByRole("button", { name: "Remove body", exact: true })
        .click();
      await ui.poll(count).toBe(0);
      await ui(page.locator("[data-reader-body]")).toHaveCount(0);
      await page
        .getByRole("button", { name: "Remount body", exact: true })
        .click();
      await ui.poll(count).toBe(1);
      await ui(target).toBeInViewport();
    } finally {
      await page.close();
    }
  }, 30_000);

  test(`${engine}: fragment scrolling restores the scroll root's previous inline policy`, async () => {
    const browser = browsers.get(engine);
    if (browser === undefined) throw new Error("Missing body fragment browser");
    const page = await browser.newPage({
      reducedMotion: "no-preference",
      viewport: { width: 390, height: 844 },
    });
    try {
      await page.goto(url);
      const target = page.getByRole("heading", {
        name: "Target section",
        exact: true,
      });
      await page.evaluate(() => {
        document.documentElement.style.setProperty(
          "scroll-behavior",
          "auto",
          "important",
        );
      });
      await page
        .getByRole("link", { name: "Read target", exact: true })
        .click();
      await ui(target).toBeInViewport();
      await ui
        .poll(() =>
          page.evaluate(() => ({
            value:
              document.documentElement.style.getPropertyValue(
                "scroll-behavior",
              ),
            priority:
              document.documentElement.style.getPropertyPriority(
                "scroll-behavior",
              ),
          })),
        )
        .toEqual({ value: "auto", priority: "important" });
    } finally {
      await page.close();
    }
  }, 30_000);
}

test("chromium: an admitted lesson fragment survives an intermediate render before saved progress", async () => {
  const browser = browsers.get("chromium");
  if (browser === undefined) throw new Error("Missing body fragment browser");
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const diagnostics: string[] = [];
  page.on("console", (message) => {
    if (message.text().startsWith("[CONTROL-2479]"))
      diagnostics.push(message.text());
  });
  try {
    await page.goto(`${url}?lesson-admission#итог`);
    await ui(page.getByRole("status")).toHaveText(
      "Продолжение рендера ожидает готовности",
    );
    const body = page.locator("[data-controlled-lesson]");
    const originalBody = await body.elementHandle();
    await page
      .getByRole("button", {
        name: "Доставить сохранённый прогресс",
        exact: true,
      })
      .click();
    await ui(page.getByLabel("Сохранённые части")).toHaveText("3");
    const observations = z
      .array(
        z.object({
          phase: z.string(),
          at: z.number(),
          openedParts: z.number().optional(),
          saved: z.number().nullable().optional(),
        }),
      )
      .parse(
        await page.evaluate((): unknown =>
          Reflect.get(window, "lessonAdmissionObservations"),
        ),
      );
    const accepted = observations.findIndex(
      (event) => event.phase === "accepted" && event.openedParts === 4,
    );
    const intermediate = observations.findIndex(
      (event) => event.phase === "intermediate",
    );
    const delivered = observations.findIndex(
      (event) => event.phase === "saved",
    );
    ui(accepted).toBeGreaterThanOrEqual(0);
    ui(intermediate).toBeGreaterThan(accepted);
    ui(delivered).toBeGreaterThan(intermediate);
    ui(observations[intermediate]).toMatchObject({
      openedParts: 1,
      saved: null,
    });
    ui(observations[delivered]).toMatchObject({ saved: 3 });
    const target = body.getByRole("heading", {
      name: "Итог",
      exact: true,
      includeHidden: true,
    });
    await ui(target).toBeVisible();
    await ui(target).toBeInViewport({ ratio: 1 });
    await ui(body.locator("[data-lesson-part][data-closed]")).toHaveCount(0);
    ui(
      await originalBody.evaluate(
        (node) => node === document.querySelector("[data-controlled-lesson]"),
      ),
    ).toBe(true);
  } finally {
    try {
      const observation = await page.evaluate(() => {
        const events: unknown = Reflect.get(
          window,
          "lessonAdmissionObservations",
        );
        return {
          events,
          hash: location.hash,
          bodies: document.querySelectorAll("[data-controlled-lesson]").length,
          cuts: [
            ...document.querySelectorAll<HTMLElement>(
              "[data-controlled-lesson] [data-lesson-part]",
            ),
          ].map((node) => ({
            part: node.dataset["lessonPart"],
            closed: node.hasAttribute("data-closed"),
          })),
          target: [
            ...document.querySelectorAll<HTMLElement>(
              "[data-controlled-lesson] [id=итог]",
            ),
          ].map((node) => ({
            connected: node.isConnected,
            rects: node.getClientRects().length,
            top: node.getBoundingClientRect().top,
            bottom: node.getBoundingClientRect().bottom,
          })),
        };
      });
      await mkdir("test-results/lesson-fragment-admission", {
        recursive: true,
      });
      await writeFile(
        "test-results/lesson-fragment-admission/chromium.json",
        JSON.stringify({ observation, diagnostics }, null, 2),
      );
    } finally {
      await page.close();
    }
  }
}, 30_000);
