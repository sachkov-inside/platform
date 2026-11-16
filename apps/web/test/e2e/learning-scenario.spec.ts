import { expect, test } from "@playwright/test";
import { learningInterceptionCatalog } from "../support/learning-interception";

test("the common learning library shows free and paid lessons under its selected topic", async ({
  page,
}) => {
  await page.route("**/auth/status", (route) =>
    route.fulfill({
      json: { state: "guest", canManageMaterials: false, accountId: null },
    }),
  );
  await page.route(/\/api\/(?:home|library)\/materials(?:\?|$)/u, (route) =>
    route.fulfill({ json: learningInterceptionCatalog() }),
  );
  await page.goto("/?topic=synthetic-learning");
  await expect(
    page.getByRole("heading", {
      name: "Учебный пример: первый шаг",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "Учебный пример: работа над проектом",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("group", { name: "Тема" })
      .getByRole("button", { name: "Учебные примеры", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
});
