import { expect, test, type Page, type TestInfo } from "@playwright/test";

const landing = "/products/performance-course";
const programme = `${landing}/programme`;

function mobile(info: TestInfo): boolean {
  return info.project.name === "mobile-chromium";
}

async function expectLandingChrome(page: Page, info: TestInfo) {
  if (mobile(info))
    await expect(page.locator(".mobile-navigation")).toBeHidden();
  else await expect(page.locator(".public-header")).toBeVisible();
  await expect(page.locator(".public-footer-slot")).toBeVisible();
}

test.describe("server-rendered route chrome", () => {
  test.use({ javaScriptEnabled: false });

  test("the landing hides mobile navigation and keeps seller documents before hydration (#2383)", async ({
    page,
  }, info) => {
    await page.goto(landing);
    await expect(
      page.locator("[data-hide-mobile-navigation-marker]").first(),
    ).toBeAttached();
    await expectLandingChrome(page, info);
  });
});

test("retained programme markers release chrome when returning to the landing (#2383)", async ({
  page,
}, info) => {
  await page.goto(landing);
  await expectLandingChrome(page, info);
  await expect
    .poll(() =>
      page
        .locator(".aie-film canvas")
        .evaluate(
          (canvas: HTMLCanvasElement) =>
            canvas.getContext("2d")?.getImageData(0, 0, 1, 1).data[3] ?? 0,
        ),
    )
    .toBe(255);
  const landingNode = await page
    .locator('[data-product-landing="performance-course"]:visible')
    .elementHandle();
  await page
    .getByRole("link", { name: "Попробовать бесплатно", exact: true })
    .click();
  await expect(page).toHaveURL(programme);
  const programmeView = page.locator(
    '[data-product-programme="performance-course"]:visible',
  );
  await expect(programmeView).toBeVisible();
  // Sample identity after the personal projection, as in course-payload.spec.ts (#2383).
  await expect(
    programmeView.locator('[data-programme-part="header"]:visible'),
  ).toContainText("всё открыто");
  await expect(
    programmeView
      .getByRole("link", { name: "Материал 1", exact: true })
      .first(),
  ).toBeVisible();
  if (mobile(info))
    await expect(page.locator(".mobile-navigation")).toBeVisible();
  else await expect(page.locator(".public-header")).toBeVisible();
  await expect(page.locator(".public-footer-slot:visible")).toHaveCount(0);
  const programmeNode = await programmeView.elementHandle();
  await expect(landingNode.evaluate((node) => node.isConnected)).resolves.toBe(
    true,
  );
  await page.goBack();
  await expect(page).toHaveURL(landing);
  await expectLandingChrome(page, info);
  await expect(
    programmeNode.evaluate((node) => node.isConnected),
  ).resolves.toBe(true);
  await expect(
    programmeNode.evaluate((node) => node.getClientRects().length),
  ).resolves.toBe(0);
  await expect(
    landingNode.evaluate(
      (node) => node.isConnected && node.getClientRects().length > 0,
    ),
  ).resolves.toBe(true);
});
