import { expect, type Locator, type Page } from "@playwright/test";

/**
 * Карточка материала в ленте Главной. Поиска на Главной нет (решение владельца 09.10.2026), поэтому
 * карточка ищется прокруткой: лента догружает следующие страницы, пока карточка не появится.
 */
export async function homeFeedCard(
  page: Page,
  title: string,
): Promise<Locator> {
  const articles = page
    .getByRole("region", { name: "Материалы", exact: true })
    .getByRole("article");
  const card = articles.filter({
    has: page.getByRole("link", { name: title, exact: true }),
  });
  await expect(articles.first()).toBeVisible();
  await expect(async () => {
    if ((await card.count()) === 0)
      await articles.last().scrollIntoViewIfNeeded();
    await expect(card).toHaveCount(1, { timeout: 1_000 });
  }).toPass();
  return card;
}
