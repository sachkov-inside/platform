import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/**
 * Неизвестный адрес с первого захода отвечает 404, показывает страницу «не найдено» и закрыт от
 * поиска. Статус ставит `proxy` до начала ответа: страница с параметром отрисовывается потоком, и
 * её `notFound()` пришёл бы уже после статуса 200 (#701, ADR 0027).
 */
async function expectNotFound(page: Page, path: string): Promise<void> {
  const response = await page.goto(path);

  expect(response?.status()).toBe(404);
  await expect(
    page.getByRole("heading", { level: 1, name: "Страница не найдена" }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "На главную" })).toBeVisible();
  // Важно, что поиск закрыт и ни один тег его не открывает, сколько бы тегов ни было.
  await expect(
    page.locator('meta[name="robots"][content="noindex"]').first(),
  ).toBeAttached();
  await expect(
    page.locator('meta[name="robots"]:not([content="noindex"])'),
  ).toHaveCount(0);
}

/** Раздел открыт без входа и без оплаты: посетитель читает условия до любой формы. */
test("юридический раздел перечисляет действующие документы", async ({
  page,
}) => {
  const response = await page.goto("/legal");

  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Документы Inside",
  );
  await expect(
    page.getByRole("link", { name: /Условия использования Inside/u }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: /Оферта разовой покупки/u }).first(),
  ).toBeVisible();
  await expect(page.getByText(/ИНН 771004514845/u).first()).toBeVisible();
});

test("документ открывается по своему адресу и называет редакцию", async ({
  page,
}) => {
  const response = await page.goto("/legal/terms");

  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Условия использования Inside",
  );
  await expect(
    page.getByText("Действует с 12 сентября 2026 года").first(),
  ).toBeVisible();
  await expect(page.getByText(/^[0-9a-f]{64}$/u)).toBeVisible();
});

test("адрес редакции остаётся рабочим и не спорит с действующим текстом", async ({
  page,
}) => {
  const response = await page.goto("/legal/terms/v1");

  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Условия использования Inside",
  );
  await expect(
    page.getByRole("link", { name: "/legal/terms/v1" }),
  ).toBeVisible();
});

test("оферта разовой покупки действует в редакции 4, а прежние остаются по своим адресам", async ({
  page,
}) => {
  const response = await page.goto("/legal/purchase");

  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Оферта разовой покупки продукта Inside",
  );
  await expect(
    page.getByText(/^Версия 4\. Действует с /u).first(),
  ).toBeVisible();
  // Списки и подразделы оферты отрисованы как разметка, а не как текст с маркерами.
  await expect(
    page.getByRole("heading", {
      level: 3,
      name: "Что не входит в сопровождение",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("listitem").filter({ hasText: "Личные встречи и созвоны." }),
  ).toBeVisible();

  const third = await page.goto("/legal/purchase/v3");
  expect(third?.status()).toBe(200);
  await expect(
    page.getByText(/^Версия 3\. Действует с /u).first(),
  ).toBeVisible();

  const earlier = await page.goto("/legal/purchase/v1");
  expect(earlier?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Оферта разовой покупки руководства Inside",
  );
  await expectNotFound(page, "/legal/purchase/v2");
});

test("реквизиты называют орган регистрации продавца", async ({ page }) => {
  await page.goto("/legal/contacts");

  await expect(
    page.getByRole("cell", {
      name: "Межрайонная инспекция Федеральной налоговой службы № 46 по г. Москве",
    }),
  ).toBeVisible();
});

test("неизвестный документ показывает «не найдено», а не пустую страницу", async ({
  page,
}) => {
  await expectNotFound(page, "/legal/facts-and-applicability");
});

/**
 * Прежде 404 приходил только из кеша, со второго захода (#701). Названные адреса могли уже открыть
 * соседние проверки, поэтому первый заход доказывают адреса, которых этот сервер ещё не видел.
 */
test("неизвестный документ и неизвестная редакция отвечают 404 с первого захода", async ({
  request,
}, testInfo) => {
  const now = Date.now();
  const unseen = `${testInfo.project.name}-${String(now)}`;

  for (const path of [
    "/legal/facts-and-applicability",
    "/legal/purchase/v2",
    `/legal/unpublished-${unseen}`,
    // Редакция из трёх цифр: адрес допустим по форме, но такой редакции нет.
    `/legal/terms/v${String(100 + (now % 900))}`,
  ]) {
    const response = await request.get(path, { maxRedirects: 0 });

    expect(response.status(), path).toBe(404);
    expect(await response.text(), path).toContain("Страница не найдена");
  }
  // Переход внутри приложения просит RSC по тому же адресу и получает тот же 404.
  const flight = await request.get(`/legal/unflown-${unseen}`, {
    headers: { RSC: "1" },
    maxRedirects: 0,
  });
  expect(flight.status()).toBe(404);
});

/** `proxy` пропускает опубликованные адреса к предсобранным страницам: общий кеш может их хранить. */
for (const path of ["/legal/terms", "/legal/terms/v1", "/legal/purchase/v4"]) {
  test(`${path} остаётся статической страницей`, async ({ request }) => {
    const response = await request.get(path, { maxRedirects: 0 });

    expect(response.status()).toBe(200);
    expect(response.headers()["cache-control"]).toMatch(/s-maxage=/u);
  });
}

test("футер ведёт к документам с любой публичной страницы", async ({
  page,
}) => {
  // Страница «Карта» не зависит от каталога, поэтому проверяет именно футер оболочки.
  await page.goto("/map");

  const footer = page.getByRole("navigation", { name: "Документы Inside" });
  await expect(
    footer.getByRole("link", { name: "Политика данных" }),
  ).toBeVisible();
  await expect(
    footer.getByRole("link", { name: "Реквизиты и обращения" }),
  ).toBeVisible();
  await footer.getByRole("link", { name: "Cookies и хранение" }).click();
  await expect(page).toHaveURL(/\/legal\/cookies$/u);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Cookies и локальное хранение в Inside",
  );
});

for (const path of ["/legal", "/legal/privacy"]) {
  test(`${path} не имеет серьёзных замечаний доступности`, async ({ page }) => {
    await page.goto(path);

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    const materialViolations = results.violations.filter(
      (violation) =>
        violation.impact === "serious" || violation.impact === "critical",
    );

    expect(materialViolations).toEqual([]);
  });
}
