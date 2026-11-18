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
    "Mouse hover is desktop evidence; phone click is separate.",
  );
  await page.clock.install({ time: "2026-11-18T10:00:00Z" });
  try {
    const trigger = await openReader(page);
    await page.clock.pauseAt("2026-11-18T12:00:00Z");
    await trigger.hover();
    await page.clock.runFor(100);
    const bubble = definition(page);
    await expect(bubble).toBeVisible();
    await bubble
      .getByRole("button", { name: "Подробнее", exact: true })
      .hover();
    // Absence beyond the close interval observes transfer, not the pre-existing open state (#2419/S2419-1).
    await page.clock.runFor(151);
    await expect(bubble).toBeVisible();
    await page.mouse.move(8, 8);
    await page.clock.runFor(151);
    await expect(bubble).toHaveCount(0);
  } finally {
    await page.clock.resume();
  }
});

test("pending synthetic glossary hover is cancelled on a real Next leave and stays closed on return", async ({
  page,
}) => {
  await page.clock.install({ time: "2026-11-18T10:00:00Z" });
  try {
    const trigger = await openReader(page);
    await page.clock.pauseAt("2026-11-18T12:00:00Z");
    await page.evaluate(() => {
      const set = window.setTimeout.bind(window);
      const clear = window.clearTimeout.bind(window);
      const setDescriptor = Object.getOwnPropertyDescriptor(
        window,
        "setTimeout",
      );
      const clearDescriptor = Object.getOwnPropertyDescriptor(
        window,
        "clearTimeout",
      );
      const scheduled: number[] = [];
      const cleared: number[] = [];
      Object.defineProperty(window, "setTimeout", {
        ...setDescriptor,
        value: (handler: TimerHandler, delay?: number, ...args: unknown[]) => {
          const id = set(handler, delay, ...args);
          if (delay === 100) scheduled.push(id);
          return id;
        },
      });
      Object.defineProperty(window, "clearTimeout", {
        ...clearDescriptor,
        value: (id?: number) => {
          clear(id);
          if (id !== undefined) cleared.push(id);
        },
      });
      Object.assign(window, {
        glossaryTimerFacts: {
          scheduled,
          cleared,
          restore: () => {
            if (setDescriptor !== undefined)
              Object.defineProperty(window, "setTimeout", setDescriptor);
            if (clearDescriptor !== undefined)
              Object.defineProperty(window, "clearTimeout", clearDescriptor);
          },
        },
      });
    });
    // Synthetic same-task pointer delivery proves timer ownership, not trusted phone hover (#2419/S2419-2).
    await trigger.evaluate((node) => {
      node.dispatchEvent(
        new PointerEvent("pointerover", {
          bubbles: true,
          pointerType: "mouse",
        }),
      );
      node.dispatchEvent(
        new PointerEvent("pointerenter", { pointerType: "mouse" }),
      );
    });
    const next = page
      .getByRole("navigation", { name: "Действия материала", exact: true })
      .getByRole("link", { name: "Назад", exact: true });
    await next.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL("/");
    await expect(
      page.getByRole("heading", { name: "Главная", exact: true }),
    ).toBeVisible();
    const facts = await page.evaluate(() => {
      const state = window as Window & {
        glossaryTimerFacts?: { scheduled: number[]; cleared: number[] };
      };
      return state.glossaryTimerFacts;
    });
    expect(facts?.scheduled).toHaveLength(1);
    expect(facts?.cleared).toContain(facts?.scheduled[0]);
    await page.clock.runFor(250);
    await expect(definition(page)).toHaveCount(0);
    await page.goBack();
    await expect(page).toHaveURL("/materials/glossary-lifetime-first");
    await expect(trigger).toBeVisible();
    await page.clock.runFor(250);
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    await expect(definition(page)).toHaveCount(0);
  } finally {
    await page.evaluate(() => {
      const state = window as Window & {
        glossaryTimerFacts?: { restore(): void };
      };
      state.glossaryTimerFacts?.restore();
      delete state.glossaryTimerFacts;
    });
    await page.clock.resume();
  }
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
  // This existing Next return link retains the route; ordinary document body links reload it.
  const next = page
    .getByRole("navigation", { name: "Действия материала", exact: true })
    .getByRole("link", { name: "Назад", exact: true });
  await expect(next).toHaveAttribute("href", "/");
  await next.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL("/");
  await expect(
    page.getByRole("heading", { name: "Главная", exact: true }),
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
