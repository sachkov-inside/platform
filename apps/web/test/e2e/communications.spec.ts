import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";

// Visual route proof: real Next page and browser adapter, synthetic BFF responses.
// Backend authorization, persistence and Telegram delivery belong to the full-stack suite.
const part = {
  partId: "31600000-0000-4000-8000-000000000001",
  content: {
    type: "text",
    text: "Разберём, как устроена доставка сообщений. Начните с материала, а завтра вернёмся к практике.",
    entities: [],
    buttons: [],
  },
};
const funnel = {
  funnelId: "31600000-0000-4000-8000-000000000002",
  name: "Знакомство с Inside",
  revision: 3,
  publishedRevision: 2,
  lifecycle: "published",
  isDefault: true,
  entryResponse: {
    stepId: "31600000-0000-4000-8000-000000000003",
    parts: [part],
  },
  steps: [
    {
      stepId: "31600000-0000-4000-8000-000000000004",
      delaySeconds: 86400,
      parts: [{ ...part, partId: "31600000-0000-4000-8000-000000000005" }],
    },
  ],
  sources: [
    {
      sourceId: "31600000-0000-4000-8000-000000000006",
      code: "m_demo",
      name: "Ролик о доставке сообщений",
    },
  ],
};

test("funnel editor fits the live route and keeps keyboard controls reachable", async ({
  page,
}, testInfo) => {
  await page.route("**/api/communications/funnels/list", (route) =>
    route.fulfill({
      json: {
        kind: "ready",
        value: {
          funnels: [funnel],
          nextCursor: null,
          botStartUrl: "https://t.me/inside_synthetic_bot",
        },
      },
    }),
  );
  await page.route("**/api/communications/intro/read", (route) =>
    route.fulfill({
      json: {
        kind: "ready",
        value: { introId: funnel.funnelId, revision: 1, parts: [part] },
      },
    }),
  );
  await page.route("**/api/communications/deliveries/read", (route) =>
    route.fulfill({
      json: { kind: "ready", value: { deliveries: [], nextCursor: null } },
    }),
  );
  await page.route("**/api/communications/funnels/preview", (route) =>
    route.fulfill({
      json: {
        kind: "ready",
        value: {
          funnelId: funnel.funnelId,
          revision: 3,
          addedStepIds: [funnel.steps[0]?.stepId],
          editedStepIds: [],
          deletedStepIds: [],
          reorderedStepIds: [],
          eligibleContacts: 12,
          completedParticipantsReceivingNewSteps: 7,
          validationErrors: [],
          targetErrors: [],
        },
      },
    }),
  );
  await page.route("**/api/communications/templates?*", (route) =>
    route.fulfill({
      json: {
        kind: "ready",
        templates: [
          {
            templateId: part.partId,
            revision: 1,
            content: {
              ...part.content,
              type: "photo",
              fileId: "synthetic-photo",
              text: "Новый пост из Telegram",
              entities: [{ type: "bold", offset: 0, length: 5 }],
              buttons: [
                {
                  text: "Материал",
                  url: "https://inside.test/materials/example",
                  row: 0,
                },
              ],
            },
          },
        ],
        nextCursor: null,
      },
    }),
  );
  await page.goto("/authoring/communications");
  await page
    .getByRole("button", { name: "Открыть Знакомство с Inside", exact: true })
    .click();
  const editor = page.getByRole("region", {
    name: "Редактор воронки",
    exact: true,
  });
  await expect(editor).toBeVisible();
  const sizes =
    testInfo.project.name === "mobile-chromium" ? [390, 320] : [1440, 1036];
  const output = "../../ci-artifacts/316";
  await mkdir(output, { recursive: true });
  for (const width of sizes) {
    await page.setViewportSize({ width, height: width < 768 ? 844 : 1024 });
    await page.getByRole("heading", { level: 1 }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${output}/live-${String(width)}-top.png` });
    await page.getByLabel("Название воронки", { exact: true }).focus();
    await page.keyboard.press("Tab");
    const checkbox = page.getByRole("checkbox", {
      name: "Стандартная воронка для обычного запуска бота",
    });
    await expect(checkbox).toBeFocused();
    await page.screenshot({
      path: `${output}/live-${String(width)}-keyboard.png`,
    });
    await page
      .getByRole("button", { name: "Проверить изменения и охват", exact: true })
      .click();
    await expect(
      page.getByText("Ожидаемый охват: 12", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Опубликовать воронку", exact: true }),
    ).toBeEnabled();
    await page
      .getByRole("heading", { name: "Проверка и публикация", exact: true })
      .scrollIntoViewIfNeeded();
    await page.screenshot({
      path: `${output}/live-${String(width)}-preview.png`,
    });
    const overflow = await page.locator("#authoring-content").evaluate((root) =>
      [
        ...root.querySelectorAll<HTMLElement>(
          "input, textarea, button, section, fieldset",
        ),
      ]
        .filter((element) => element.getBoundingClientRect().width > 0)
        .filter((element) => {
          const box = element.getBoundingClientRect();
          return box.left < 0 || box.right > innerWidth + 1;
        })
        .map(
          (element) =>
            element.getAttribute("aria-label") ??
            element.textContent?.slice(0, 80),
        ),
    );
    expect(overflow).toEqual([]);
    expect(
      (await new AxeBuilder({ page }).include("#authoring-content").analyze())
        .violations,
    ).toEqual([]);
  }
  let savedDraft: typeof funnel | undefined;
  await page.route("**/api/communications/funnels/save", async (route) => {
    const request = route.request();
    const contentType = request.headers()["content-type"];
    const body = request.postData();
    if (!contentType || !body) throw new Error("Missing mutation body");
    const form = await new Request(request.url(), {
      method: "POST",
      headers: { "content-type": contentType },
      body,
    }).formData();
    const raw = form.get("input");
    if (typeof raw !== "string") throw new Error("Missing form input");
    const input = JSON.parse(raw) as {
      draft: typeof funnel;
    };
    savedDraft = input.draft;
    return route.fulfill({
      json: {
        kind: "ready",
        value: {
          ...input.draft,
          revision: 4,
          publishedRevision: 2,
          lifecycle: "published",
        },
      },
    });
  });
  const entry = page.getByRole("group", {
    name: "Непосредственный ответ по ссылке",
    exact: true,
  });
  await entry
    .getByRole("button", {
      name: "Заменить часть 1 из сохранённых постов",
      exact: true,
    })
    .click();
  await entry
    .getByRole("button", { name: "Новый пост из Telegram · v1", exact: true })
    .click();
  expect(savedDraft).toBeUndefined();
  await expect(
    entry.getByRole("textbox", { name: "Название кнопки 1", exact: true }),
  ).toHaveValue("Материал");
  await page.screenshot({
    path: `${output}/live-${testInfo.project.name}-post-picker.png`,
  });
  expect(
    (await new AxeBuilder({ page }).include("#authoring-content").analyze())
      .violations,
  ).toEqual([]);
  await entry
    .getByRole("button", { name: "Заменить выбранную часть", exact: true })
    .click();
  await expect(
    entry.getByText("Новый пост из Telegram", { exact: true }),
  ).toBeVisible();
  await expect(entry.getByRole("textbox")).toHaveCount(0);
  expect(savedDraft).toBeUndefined();
  await page
    .getByRole("button", { name: "Сохранить черновик", exact: true })
    .click();
  await expect(
    page.getByText("Черновик сохранён. Опубликованные сообщения не изменены.", {
      exact: true,
    }),
  ).toBeVisible();
  expect(savedDraft?.entryResponse.parts[0]?.partId).toBe(part.partId);
  expect(savedDraft?.entryResponse.parts[0]?.content).toMatchObject({
    type: "photo",
    fileId: "synthetic-photo",
    entities: [{ type: "bold", offset: 0, length: 5 }],
    buttons: [{ row: 0 }],
  });
  expect(savedDraft?.steps[0]?.delaySeconds).toBe(86400);
});
