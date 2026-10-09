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
  await page
    .getByRole("link", { name: "Назад к материалам", exact: true })
    .first()
    .click();
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
