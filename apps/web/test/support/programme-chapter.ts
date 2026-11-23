import { expect, type Locator, type Page } from "@playwright/test";

/**
 * The open chapter window of a programme. A programme with chapters shows them as tiles; the
 * lessons, tasks and continue action of a chapter live in its window.
 */
export function programmeChapterWindow(page: Page): Locator {
  // Next.js keeps a visited programme in the document hidden; only the shown one counts.
  return page
    .locator("dialog[data-chapter-window][open]")
    .filter({ visible: true });
}

/**
 * Opens a chapter of the visible programme from its tile and returns its window: chapter `number`,
 * or the current one, whose tile carries the continue lesson.
 */
export async function openProgrammeChapter(
  page: Page,
  chapter: number | "current",
): Promise<Locator> {
  // A tile opens its window once the programme has hydrated; its section switch says when.
  await expect(
    page
      .getByRole("navigation", { name: "Разделы продукта" })
      .getByRole("button")
      .first(),
  ).toBeEnabled();
  const tiles = page
    .locator("[data-product-programme]:visible")
    .getByRole("list", { name: "Главы", exact: true });
  // Opened from the keyboard: a window opening under a resting pointer would count as hover intent
  // on whichever link appears beneath it and prefetch that page before the test asks for it.
  await (
    chapter === "current"
      ? tiles.locator("[data-chapter-tile][data-current]")
      : tiles.getByRole("button", {
          name: new RegExp(`Глава ${String(chapter)} `, "u"),
        })
  ).press("Enter");
  const window = programmeChapterWindow(page);
  await expect(window).toBeVisible();
  return window;
}
