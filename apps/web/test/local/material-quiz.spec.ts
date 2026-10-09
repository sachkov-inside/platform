import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { z } from "zod";
import { readerBlocks } from "../../src/storybook/quiz-content";
import { screenshotWholePage } from "../support/whole-page-screenshot.mjs";
import { hideDevelopmentFeedback } from "../support/hide-development-feedback";
import { resolve } from "node:path";

const receipt = z.object({
  materialId: z.uuid(),
  contentVersion: z.number(),
});

test("imported Reader quiz supports keyboard, all explanations, anchors and editor roundtrip", async ({
  page,
  request,
}, testInfo) => {
  await hideDevelopmentFeedback(page);
  const { convertMarkdown } =
    await import("../../../../tools/authoring/markdown.mjs");
  const { readerBlocksSchema } = await import("@inside/material-blocks");
  const environment = await request.get(
    "/__local-api/authoring/import/materials/environment",
  );
  expect(environment.ok()).toBe(true);
  expect(await environment.json()).toMatchObject({ mode: "development" });
  const identity = randomUUID();
  const source = {
    id: `quiz-review:${identity}`,
    path: "fixtures/quiz.md",
    revision: "a".repeat(64),
    showInFeed: false,
  };
  const reservedResponse = await request.post(
    "/__local-api/authoring/import/materials/reserve",
    { data: { source } },
  );
  expect(reservedResponse.ok()).toBe(true);
  const reserved = receipt.parse(await reservedResponse.json());
  const body = convertMarkdown("RAW ANSWER KEY", {
    readerBlocks: readerBlocksSchema.parse(readerBlocks),
    sourceId: source.id,
    sourcePath: source.path,
    link: (href) => href,
    image: () => identity,
  });
  const topicsResponse = await request.get(
    "/__local-api/authoring/collections?kind=topic",
  );
  expect(topicsResponse.ok()).toBe(true);
  const topics = z
    .array(z.object({ id: z.uuid() }))
    .parse(await topicsResponse.json());
  const topic = topics[0];
  if (topic === undefined)
    throw new Error("Isolated runtime must seed one topic");
  const metadata = {
    title: "Задача начинается с результата",
    summary: "Синтетическая проверка квиза #1283",
    access: "free",
    difficulty: "basic",
    outcomes: [],
    topicId: topic.id,
    formatId: "guide",
    tagIds: [],
    seriesIds: [],
  };
  const apply = await request.post(
    "/__local-api/authoring/import/materials/apply",
    {
      headers: { "Idempotency-Key": `quiz-review-${identity}` },
      data: {
        source,
        materialId: reserved.materialId,
        expectedContentVersion: reserved.contentVersion,
        publicationState: "published",
        primaryVideoId: null,
        videoChapters: [],
        body,
        metadata,
      },
    },
  );
  expect(apply.ok(), await apply.text()).toBe(true);
  const saved = receipt.parse(await apply.json());
  const detailResponse = await request.get(
    `/__local-api/authoring/materials/${saved.materialId}`,
  );
  expect(detailResponse.ok()).toBe(true);
  const detail = z
    .object({ metadata: z.object({ slug: z.string() }) })
    .parse(await detailResponse.json());
  await page.goto(`/materials/${detail.metadata.slug}`);
  const quiz = page.locator("[data-material-quiz]");
  await expect(
    quiz.getByRole("heading", { name: "Проверьте понимание" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Понятно", exact: true }).click();
  await expect(quiz).not.toContainText("RAW ANSWER KEY");
  await expect(quiz).not.toContainText("Неверно.");
  const first = quiz.getByRole("button", { name: /1\. Форма написана/u });
  await first.focus();
  await page.keyboard.press("Enter");
  await expect(quiz.getByText("Пока неверно", { exact: true })).toBeVisible();
  await quiz.getByRole("button", { name: "Ответить ещё раз" }).click();
  await expect(first).toBeFocused();
  const second = quiz.getByRole("button", { name: /2\. После отправки/u });
  await second.focus();
  await page.keyboard.press("Space");
  await expect(quiz.getByText("Правильно", { exact: true })).toBeVisible();
  await quiz.getByRole("button", { name: "Не знаю" }).click();
  await expect(quiz).toContainText("Не знаю · без оценки");
  await quiz.getByRole("button", { name: "Все объяснения" }).click();
  await expect(
    quiz.getByRole("heading", { name: "Разбор всех вариантов" }),
  ).toBeVisible();
  await quiz
    .getByRole("link", { name: "Повторить раздел", exact: true })
    .first()
    .click();
  await expect(page).toHaveURL(/#%D0%BF|#проверяемый-результат/u);
  await expect(page.locator('[id="проверяемый-результат"]')).toBeInViewport();
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth ===
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
  expect(
    (await new AxeBuilder({ page }).include("[data-material-quiz]").analyze())
      .violations,
  ).toEqual([]);
  if (process.env["CAPTURE_EVIDENCE"] === "1") {
    await quiz.getByRole("heading", { name: "Проверьте понимание" }).click();
    await screenshotWholePage(page, {
      animations: "disabled",
      path: resolve(
        "../../docs/evidence/issue-1283",
        `live-${testInfo.project.name}.png`,
      ),
    });
  }
  await page.reload();
  await expect(page.locator("[data-material-quiz]")).not.toContainText(
    "Неверно.",
  );
  await page.goto(`/authoring/materials/${saved.materialId}`);
  await expect(page.locator("[data-authoring-quiz]")).toContainText(
    "Квиз редактируется в Content",
  );
  await expect(page.locator('.tiptap[contenteditable="true"]')).toHaveCount(0);
  await expect(page.getByLabel("Название", { exact: true })).toBeDisabled();
  const draftResponse = await request.post("/__local-api/authoring/materials", {
    headers: { "Idempotency-Key": `quiz-editor-${identity}` },
    data: { metadata, body },
  });
  expect(draftResponse.ok(), await draftResponse.text()).toBe(true);
  const draft = receipt.parse(await draftResponse.json());
  await page.goto(`/authoring/materials/${draft.materialId}`);
  const editor = page.locator('.tiptap[contenteditable="true"]');
  await expect(editor).toBeVisible();
  const before = await request.get(
    `/__local-api/authoring/materials/${draft.materialId}`,
  );
  expect(before.ok()).toBe(true);
  const snapshot = z.object({ body: z.unknown() }).parse(await before.json());
  await editor
    .locator("p")
    .filter({ hasText: "Перед тем как" })
    .first()
    .click();
  await page.keyboard.press("End");
  const savedResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/authoring/materials" &&
      response.request().method() === "PUT",
  );
  await page.keyboard.type(" Проверка редактора.");
  expect((await savedResponse).ok()).toBe(true);
  await expect
    .poll(async () => {
      const response = await request.get(
        `/__local-api/authoring/materials/${draft.materialId}`,
      );
      if (!response.ok()) return 0;
      return z
        .object({ contentVersion: z.number() })
        .parse(await response.json()).contentVersion;
    })
    .toBeGreaterThan(draft.contentVersion);
  await expect(page.locator("header [role=status]")).toContainText("Сохранено");
  await page.reload();
  await expect(editor).toContainText("Проверка редактора.");
  await expect(page.locator("[data-authoring-quiz]")).toContainText(
    "Квиз редактируется в Content",
  );
  const after = await request.get(
    `/__local-api/authoring/materials/${draft.materialId}`,
  );
  expect(after.ok()).toBe(true);
  const reopened = z
    .object({
      body: z.object({
        doc: z.object({
          content: z.array(
            z
              .object({
                type: z.string(),
                attrs: z.record(z.string(), z.unknown()).optional(),
              })
              .loose(),
          ),
        }),
      }),
    })
    .parse(await after.json());
  const original = z
    .object({
      doc: z.object({
        content: z.array(
          z
            .object({
              type: z.string(),
              attrs: z.record(z.string(), z.unknown()).optional(),
            })
            .loose(),
        ),
      }),
    })
    .parse(snapshot.body);
  expect(
    reopened.body.doc.content.find((node) => node.type === "quiz"),
  ).toEqual(original.doc.content.find((node) => node.type === "quiz"));
  console.info(
    JSON.stringify({
      readerUrl: `/materials/${detail.metadata.slug}`,
      editorUrl: `/authoring/materials/${saved.materialId}`,
      editorDraftUrl: `/authoring/materials/${draft.materialId}`,
      project: testInfo.project.name,
      materialId: saved.materialId,
    }),
  );
});
