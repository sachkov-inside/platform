import { expect, test, type Page } from "@playwright/test";

async function openReader(page: Page) {
  await page.goto("/materials/glossary-lifetime-first");
  await expect(
    page.getByRole("heading", { name: "Проверка словаря", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Понятно", exact: true }).click();
  return page.getByRole("button", {
    name: "ограниченные контексты",
    exact: true,
  });
}

const definition = (page: Page) =>
  page.getByRole("dialog", { name: "Ограниченный контекст", exact: true });

test("a glossary definition pins, expands, fits the viewport and returns keyboard focus", async ({
  page,
}) => {
  const trigger = await openReader(page);
  await trigger.scrollIntoViewIfNeeded();
  const paragraph = trigger.locator("..");
  const before = await paragraph.evaluate((node) => ({
    width: node.getBoundingClientRect().width,
    height: node.getBoundingClientRect().height,
  }));
  await trigger.focus();
  await page.keyboard.press("Enter");
  const bubble = definition(page);
  await expect(bubble).toBeVisible();
  await expect(bubble).toContainText(
    "Граница, внутри которой у слов модели один смысл.",
  );
  await expect(bubble).not.toContainText("Часть системы со своей моделью");
  await bubble.getByRole("button", { name: "Подробнее", exact: true }).click();
  await expect(bubble).toContainText(
    "Часть системы со своей моделью и своим языком.",
  );
  await expect(
    bubble.getByRole("button", { name: "Свернуть", exact: true }),
  ).toHaveAttribute("aria-expanded", "true");
  expect(
    await paragraph.evaluate((node) => ({
      width: node.getBoundingClientRect().width,
      height: node.getBoundingClientRect().height,
    })),
  ).toEqual(before);
  const bounds = await bubble.evaluate((node) => ({
    left: Number.parseFloat(node.style.left),
    right:
      Number.parseFloat(node.style.left) + node.getBoundingClientRect().width,
    viewport: document.documentElement.clientWidth,
  }));
  expect(bounds.left).toBeGreaterThanOrEqual(16);
  expect(bounds.right).toBeLessThanOrEqual(bounds.viewport - 16);
  await page.keyboard.press("Escape");
  await expect(bubble).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await trigger.click();
  await expect(definition(page)).toBeVisible();
  await expect(definition(page)).not.toContainText(
    "Часть системы со своей моделью",
  );
  await page
    .getByRole("heading", { name: "Проверка словаря", exact: true })
    .click();
  await expect(definition(page)).toHaveCount(0);
});

test("a genuine mouse transfers between a term and its definition before closing outside", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name === "mobile-chromium",
    "Mouse hover is exercised on the desktop project; phone click is separate.",
  );
  const trigger = await openReader(page);
  await trigger.hover();
  const bubble = definition(page);
  await expect(bubble).toBeVisible();
  await bubble.getByRole("button", { name: "Подробнее", exact: true }).hover();
  await expect(bubble).toBeVisible();
  await page.mouse.move(8, 8);
  await expect(bubble).toHaveCount(0);
});

test("a pinned expanded glossary definition keeps its DOM across a real Next return", async ({
  page,
}) => {
  const trigger = await openReader(page);
  await trigger.click();
  const bubble = definition(page);
  await bubble.getByRole("button", { name: "Подробнее", exact: true }).click();
  await expect(bubble).toContainText(
    "Часть системы со своей моделью и своим языком.",
  );
  const originalTrigger = await trigger.elementHandle();
  const originalBubble = await bubble.elementHandle();
  // A keyboard link activation preserves the pin; outside pointer input intentionally dismisses it.
  const next = page
    .locator("[data-reader-body]")
    .getByRole("link", { name: "Следующий пример", exact: true });
  await next.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL("/materials/glossary-lifetime-second");
  await expect(
    page.getByRole("heading", { name: "Следующий пример", exact: true }),
  ).toBeVisible();
  expect(await originalTrigger.evaluate((node) => node.isConnected)).toBe(true);
  expect(await originalBubble.evaluate((node) => node.isConnected)).toBe(true);
  await expect(bubble).toHaveCount(0);
  await page.goBack();
  await expect(page).toHaveURL("/materials/glossary-lifetime-first");
  await expect(bubble).toBeVisible();
  await expect(bubble).toContainText(
    "Часть системы со своей моделью и своим языком.",
  );
  expect(
    await originalTrigger.evaluate(
      (node) =>
        node ===
        document.querySelector('[data-glossary-term="bounded-context"]'),
    ),
  ).toBe(true);
  expect(
    await originalBubble.evaluate(
      (node) =>
        node ===
        document.querySelector('[data-glossary-bubble="bounded-context"]'),
    ),
  ).toBe(true);
  await page.keyboard.press("Escape");
  await expect(bubble).toHaveCount(0);
  await expect(trigger).toBeFocused();
});
