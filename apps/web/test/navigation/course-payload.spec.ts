import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { screenshotWholePage } from "../support/whole-page-screenshot.mjs";

const programme = "/products/performance-course/programme";

test("the 120-Material programme sends one card tree and the catalogue searches beyond its first batch", async ({
  page,
  request,
}, testInfo) => {
  const response = await request.get(programme, { headers: { RSC: "1" } });
  expect(response.ok()).toBe(true);
  expect(response.headers()["content-type"]).toContain("text/x-component");
  const flight = await response.text();
  await testInfo.attach("programme-flight.txt", {
    body: flight,
    contentType: "text/plain",
  });
  await testInfo.attach("payload-metrics.json", {
    body: JSON.stringify({
      corpus: 120,
      flightBytes: Buffer.byteLength(flight),
    }),
    contentType: "application/json",
  });
  // Feed markup belongs to the closed catalogue, so it must be absent from the initial Flight.
  expect(flight).not.toContain('"data-material-variant":"feed"');
  await page.goto(programme);
  await expect(
    page.locator("[data-series-order]:visible").first(),
  ).toBeVisible();
  // The personal projection replaces the shared fallback; switch parts once its access state has landed.
  await expect(
    page.locator(
      '[data-product-programme="performance-course"] [data-programme-part="header"]:visible',
    ),
  ).toContainText("всё открыто");
  await page
    .getByRole("navigation", { name: "Разделы продукта" })
    .getByRole("button", { name: /^Материалы/u })
    .click();
  const catalogue = page.getByRole("list", { name: "Материалы курса" });
  await expect(catalogue.getByRole("listitem")).toHaveCount(12);
  await expect(catalogue.getByRole("heading").first()).toHaveText(
    "Материал 120",
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await testInfo.attach("catalogue-first-batch.png", {
    body: await screenshotWholePage(page),
    contentType: "image/png",
  });
  const search = page.getByRole("searchbox", {
    name: "Поиск по материалам курса",
  });
  await search.fill("Описание материала 1.");
  await expect(
    catalogue.getByRole("heading", { name: "Материал 1", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Видео", exact: true }).click();
  await expect(
    catalogue.getByRole("heading", { name: "Материал 1", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Дополнительные", exact: true })
    .click();
  await expect(
    catalogue.getByRole("heading", { name: "Материал 1", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Из программы", exact: true }).click();
  await expect(
    catalogue.getByRole("heading", { name: "Материал 1", exact: true }),
  ).toBeVisible();
  await catalogue
    .getByRole("link", { name: "Материал 1", exact: true })
    .click();
  await expect(page.locator("[data-reader-body]:visible")).toBeVisible();
  const course = page.locator("[data-course-reading]:visible");
  const programmeButton = course.getByRole("button", {
    name: "Вся программа",
    exact: true,
  });
  const mobile = await programmeButton.isVisible();
  if (mobile) {
    await programmeButton.click();
    await page.keyboard.press("Escape");
  }
  const returnLink = mobile
    ? course
        .getByRole("navigation", { name: "Хлебные крошки" })
        .getByRole("link")
        .first()
    : course
        .getByRole("navigation", { name: "Хлебные крошки" })
        .getByRole("link")
        .first();
  await expect(returnLink).toHaveAttribute(
    "href",
    `${programme}?part=materials&at=performance-lesson-1`,
  );
  await returnLink.click();
  await expect(page.locator("dialog[open]")).toHaveCount(0);
  await expect(page).toHaveURL(/part=materials.*at=performance-lesson-1/u);
  await expect(
    page.locator('[data-route-material="performance-lesson-1"]:visible'),
  ).toBeInViewport();
  await page.reload();
  await expect(
    page.locator('[data-route-material="performance-lesson-1"]:visible'),
  ).toBeInViewport();
  const accessibility = await new AxeBuilder({ page })
    .include("[data-material-catalog]")
    .analyze();
  expect(accessibility.violations).toEqual([]);
});

test("programme reveals the next batch before the last loaded lesson reaches the scroll edge", async ({
  page,
}) => {
  // Hold the shell's real media-query event until the new scroll owner has moved.
  // This pins the browser ordering that otherwise makes the resize failure intermittent.
  await page.addInitScript(() => {
    const matchMedia = window.matchMedia.bind(window);
    window.matchMedia = (query) => {
      const media = matchMedia(query);
      if (query !== "(width >= 64rem)") return media;
      const add = media.addEventListener.bind(media);
      media.addEventListener = (
        type: string,
        listener: EventListenerOrEventListenerObject | null,
        options?: boolean | AddEventListenerOptions,
      ) => {
        if (listener === null) return;
        if (type !== "change") {
          add(type, listener, options);
          return;
        }
        add(
          "change",
          (event) => {
            document.documentElement.dataset["pendingShellScrollTransfer"] =
              "true";
            window.addEventListener(
              "test:flush-shell-resize",
              () => {
                delete document.documentElement.dataset[
                  "pendingShellScrollTransfer"
                ];
                if (typeof listener === "function") listener.call(media, event);
                else listener.handleEvent(event);
              },
              { once: true },
            );
          },
          options,
        );
      };
      return media;
    };
  });
  await page.goto(programme);
  const surface = page.locator(
    '[data-product-programme="performance-course"]:visible',
  );
  await expect(surface.locator('[data-programme-part="header"]')).toContainText(
    "всё открыто",
  );
  const rows = surface.locator("[data-series-ordinal]");
  await expect(rows).toHaveCount(24);
  const first = rows.first();
  await first.evaluate((node) => {
    node.setAttribute("data-retained-lesson", "true");
  });
  for (const loaded of [24, 36, 48]) {
    await rows.nth(loaded - 1).evaluate((node) => {
      const main = node.closest("main");
      node.scrollIntoView({ block: "end" });
      if (main !== null && getComputedStyle(main).overflowY === "auto") {
        main.scrollTop -= 320;
      } else {
        window.scrollBy(0, -320);
      }
    });
    if (loaded === 36) {
      await page.evaluate(() =>
        window.dispatchEvent(new Event("test:flush-shell-resize")),
      );
    }
    await expect(rows).toHaveCount(loaded + 12);
    await expect(first).toHaveAttribute("data-retained-lesson", "true");
    if (loaded === 24) {
      const desktop = (page.viewportSize()?.width ?? 0) >= 1024;
      await page.setViewportSize(
        desktop ? { width: 390, height: 844 } : { width: 1440, height: 1024 },
      );
      await expect(page.locator("html")).toHaveAttribute(
        "data-pending-shell-scroll-transfer",
        "true",
      );
    }
  }
  expect(
    await rows.evaluateAll((nodes) =>
      nodes.map((node) => Number(node.getAttribute("data-series-ordinal"))),
    ),
  ).toEqual(Array.from({ length: 60 }, (_, index) => index + 1));
});

for (const version of ["v1", "v2", "v3"] as const) {
  test(`course film ${version} draws its selected reduced-motion frame without hydration errors`, async ({
    page,
  }, testInfo) => {
    const errors: string[] = [];
    const scripts: Promise<{ url: string; source: string }>[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (
        message.type() === "error" &&
        /hydrat|did not match|didn't match/iu.test(message.text())
      ) {
        errors.push(message.text());
      }
    });
    page.on("response", (response) => {
      if (response.request().resourceType() !== "script") return;
      scripts.push(
        response.text().then((source) => ({ url: response.url(), source })),
      );
    });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(`/products/performance-course?film=${version}`);
    await expect(
      page.locator(
        '[data-product-landing="performance-course"][data-product-presentation="ai-engineering-course"]:visible',
      ),
    ).toBeVisible();
    const film = page.locator(".aie-film:visible canvas");
    await expect(film).toHaveAccessibleName(
      version === "v1"
        ? /одним непрерывным движением/u
        : version === "v2"
          ? /путь одной фичи/u
          : /^Анимация курса: навыки AI-инженера\. Агент/u,
    );
    await expect
      .poll(() =>
        film.evaluate((canvas: HTMLCanvasElement) => {
          const context = canvas.getContext("2d");
          return context?.getImageData(0, 0, 1, 1).data[3] ?? 0;
        }),
      )
      .toBe(255);
    const loadedScripts = await Promise.all(scripts);
    const source = loadedScripts
      .map((script) => script.source)
      .join("\n")
      .replace(/\\u([\da-f]{4})/giu, (_match: string, code: string) =>
        String.fromCharCode(Number.parseInt(code, 16)),
      );
    expect(
      source.includes("навыки AI-инженера одним непрерывным движением"),
    ).toBe(version === "v1");
    expect(source.includes("Анимация курса: путь одной фичи")).toBe(
      version === "v2",
    );
    await testInfo.attach("course-script-metrics.json", {
      body: JSON.stringify({
        version,
        scriptBytes: loadedScripts.reduce(
          (total, script) => total + Buffer.byteLength(script.source),
          0,
        ),
        urls: loadedScripts.map((script) => script.url),
      }),
      contentType: "application/json",
    });
    const still = await film.evaluate((canvas: HTMLCanvasElement) =>
      canvas.toDataURL(),
    );
    const nextFrame = await film.evaluate(async (canvas: HTMLCanvasElement) => {
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            resolve();
          }),
        ),
      );
      return canvas.toDataURL();
    });
    expect(nextFrame).toBe(still);
    expect(errors).toEqual([]);
  });
}

test("course canvas resizes its backing store when only slot height changes", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/products/performance-course");
  const canvas = page.locator(".aie-film canvas").first();
  await expect(canvas).toBeVisible();
  for (const ratio of ["2 / 1", "1 / 1", "3 / 2"]) {
    await canvas.evaluate((element, aspectRatio) => {
      const slot = element.parentElement;
      if (slot === null) throw new Error("Missing film slot");
      slot.style.aspectRatio = aspectRatio;
    }, ratio);
    await expect
      .poll(() =>
        canvas.evaluate((element: HTMLCanvasElement) => {
          const dpr = Math.min(
            window.devicePixelRatio > 0 ? window.devicePixelRatio : 1,
            2,
          );
          const context = element.getContext("2d");
          if (context === null) return false;
          const transform = context.getTransform();
          return (
            element.width === Math.round(element.clientWidth * dpr) &&
            element.height === Math.round(element.clientHeight * dpr) &&
            Math.abs(transform.a - transform.d) < 0.001 &&
            transform.e >= -0.001 &&
            transform.f >= -0.001 &&
            transform.e + 960 * transform.a <= element.width + 0.001 &&
            transform.f + 640 * transform.d <= element.height + 0.001
          );
        }),
      )
      .toBe(true);
  }
});
