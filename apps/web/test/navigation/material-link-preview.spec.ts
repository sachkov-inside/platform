import { expect, test } from "@playwright/test";

for (const userAgent of [
  "TelegramBot (like TwitterBot)",
  "TelegramBot",
  "Googlebot",
]) {
  test(`${userAgent} получает открытую статью и картинку без JavaScript`, async ({
    browser,
    baseURL,
    request,
  }) => {
    const context = await browser.newContext({
      baseURL: String(baseURL),
      javaScriptEnabled: false,
      userAgent,
    });
    try {
      const page = await context.newPage();
      const response = await page.goto(
        "/materials/navigation-lesson-1?utm_source=telegram",
      );
      expect(response?.status()).toBe(200);
      await expect(page.locator('meta[property="og:title"]')).toHaveAttribute(
        "content",
        "Первый бесплатный урок",
      );
      if (userAgent !== "Googlebot") {
        await expect(
          page.locator('head meta[property="og:image"]'),
        ).toHaveCount(1);
      }
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
        "href",
        `${String(baseURL)}/materials/navigation-lesson-1`,
      );
      await expect(page.locator("[data-reader-body]")).toContainText(
        "Раздел урока",
      );
      const article: unknown = JSON.parse(
        (await page
          .locator('script[type="application/ld+json"]')
          .textContent()) ?? "null",
      );
      expect(article).toMatchObject({
        "@type": "Article",
        headline: "Первый бесплатный урок",
        mainEntityOfPage: `${String(baseURL)}/materials/navigation-lesson-1`,
      });
      expect(article).not.toHaveProperty("articleBody");
      const imageUrl = await page
        .locator('meta[property="og:image"]')
        .getAttribute("content");
      expect(imageUrl).toBe(
        `${String(baseURL)}/materials/navigation-lesson-1/social-card`,
      );
      const image = await request.get(String(imageUrl));
      expect(image.status()).toBe(200);
      expect(image.headers()["content-type"]).toBe("image/png");
    } finally {
      await context.close();
    }
  });
}

test("закрытая карточка сохраняет превью, но не отдаёт статью и закрытый текст боту", async ({
  request,
}) => {
  const response = await request.get("/materials/navigation-lesson-3", {
    headers: { "user-agent": "TelegramBot (like TwitterBot)" },
  });
  const html = await response.text();
  expect(html).toContain('property="og:title" content="Первый платный урок"');
  expect(html).not.toContain('type="application/ld+json"');
  expect(html).not.toContain("ЗАКРЫТОЕ-ТЕЛО-УРОКА");
});

test("неизвестный или неопубликованный материал не получает статью", async ({
  request,
}) => {
  const response = await request.get("/materials/not-published-link-preview", {
    headers: { "user-agent": "TelegramBot (like TwitterBot)" },
  });
  const html = await response.text();
  expect(html).not.toContain('type="application/ld+json"');
  expect(html).not.toContain('property="og:image"');
  expect(html).toContain('name="robots" content="noindex, nofollow"');
});
