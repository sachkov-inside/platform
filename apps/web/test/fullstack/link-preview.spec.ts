import { expect, test, type Page } from "@playwright/test";

async function metaContent(page: Page, property: string): Promise<string | null> {
  return page.locator(`meta[property="${property}"]`).getAttribute("content");
}

test("главная отдаёт карточку ссылки с названием площадки и картинкой", async ({
  baseURL,
  page,
}) => {
  await page.goto("/");

  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    `${String(baseURL)}/`,
  );
  expect(await metaContent(page, "og:site_name")).toBe("Sachkov Inside");
  expect(await metaContent(page, "og:locale")).toBe("ru_RU");
  expect(await metaContent(page, "og:image")).toBe(`${String(baseURL)}/social-card`);
});

test("ссылка на руководство и на материал показывает название, описание и картинку", async ({
  baseURL,
  page,
  request,
}) => {
  await page.goto("/guides/platform-inside");

  const title = await metaContent(page, "og:title");
  expect(title).toContain("руководство");
  expect(await metaContent(page, "og:description")).not.toBe("");
  const image = await metaContent(page, "og:image");
  expect(image).toBe(`${String(baseURL)}/guides/platform-inside/social-card`);

  const card = await request.get(String(image));
  expect(card.status()).toBe(200);
  expect(card.headers()["content-type"]).toBe("image/png");
});

test("совместимый адрес `/series/` указывает на канонический адрес руководства", async ({
  baseURL,
  page,
}) => {
  await page.goto("/series/platform-inside");

  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    `${String(baseURL)}/guides/platform-inside`,
  );
  expect(await metaContent(page, "og:url")).toBe(
    `${String(baseURL)}/guides/platform-inside`,
  );
});

test("закрытый материал отдаёт карточку названия без тела материала", async ({
  page,
}) => {
  await page.goto("/materials/developer-pipeline-bez-poteri-konteksta");

  expect(await metaContent(page, "og:title")).toBe(
    "Developer Pipeline без потери контекста",
  );
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
    "content",
    /index/u,
  );
  await expect(page.getByRole("heading", { name: "Продолжение для участников" })).toBeVisible();
});

test("карта сайта перечисляет опубликованные руководства, темы и материалы", async ({
  baseURL,
  request,
}) => {
  const response = await request.get("/sitemap.xml");

  expect(response.status()).toBe(200);
  const body = await response.text();
  expect(body).toContain(`<loc>${String(baseURL)}/guides/platform-inside</loc>`);
  expect(body).toContain(`<loc>${String(baseURL)}/topics/platform</loc>`);
  expect(body).toContain(
    `<loc>${String(baseURL)}/materials/kak-ustroen-inside-platform</loc>`,
  );
  expect(body).not.toContain("/authoring");
  expect(body).not.toContain("/account");
});
