import { chromium, expect } from "@playwright/test";
import { test } from "vitest";
import {
  localAccountsPage,
  localAccountsToolbarScript,
} from "../../../../scripts/local-accounts-view.mjs";

test("the local role controls scroll away with the material", async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.route("http://stand.test/**", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: route.request().url().endsWith("/__local/accounts")
          ? localAccountsPage({ choice: "owner", returnTo: "/" })
          : '<header>Шапка</header><main data-application-content style="height:300px;overflow:auto"><article style="height:1600px">Материал</article></main>',
      }),
    );
    await page.goto("http://stand.test/");
    await page.addScriptTag({ content: localAccountsToolbarScript() });
    const change = page.getByRole("link", { name: "Сменить" });
    await expect(change).toBeInViewport();
    await page.locator("main").evaluate((main) => {
      main.scrollTop = 700;
    });
    await expect(change).not.toBeInViewport({ timeout: 1000 });
    // Client navigation keeps the previous page mounted but hidden.
    await page.locator("main").evaluate((main) => {
      main.hidden = true;
      main.insertAdjacentHTML(
        "afterend",
        '<main id="authoring-content">Редактор</main>',
      );
    });
    await expect(change).toBeInViewport({ timeout: 1000 });
  } finally {
    await browser.close();
  }
});
