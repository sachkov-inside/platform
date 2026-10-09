import type { Page } from "@playwright/test";

export async function hideDevelopmentFeedback(page: Page) {
  await page.addInitScript(() => {
    document.addEventListener("DOMContentLoaded", () => {
      const style = document.createElement("style");
      style.textContent =
        "[data-agentation-root], agentation-toolbar, [data-agentation-portal], nextjs-portal { display: none !important; }";
      document.head.append(style);
    });
  });
}
