import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { z } from "zod";
import { convertMarkdown } from "../../../../tools/authoring/markdown.mjs";
import { readerBlocksSchema } from "@inside/material-blocks";
import { readerBlocks } from "../../src/storybook/quiz-content";
import { screenshotWholePage } from "../support/whole-page-screenshot.mjs";
import { resolve } from "node:path";

const receipt = z.object({
  materialId: z.uuid(),
  contentVersion: z.number(),
});

test("imported Reader quiz supports keyboard, all explanations, anchors and editor roundtrip", async ({
  page,
  request,
}, testInfo) => {
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
        metadata: {
          title: "Задача начинается с результата",
          summary: "Синтетическая проверка квиза #1283",
          access: "free",
          difficulty: "basic",
          outcomes: [],
          topicId: topic.id,
          formatId: "guide",
          tagIds: [],
          seriesIds: [],
        },
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
  if (process.env["CAPTURE_EVIDENCE"] === "1")
    await screenshotWholePage(page, {
      animations: "disabled",
      path: resolve(
        "../../docs/evidence/issue-1283",
        `live-${testInfo.project.name}.png`,
      ),
    });
  await page.reload();
  await expect(page.locator("[data-material-quiz]")).not.toContainText(
    "Неверно.",
  );
  await page.goto(`/authoring/materials/${saved.materialId}`);
  await expect(page.locator("[data-authoring-quiz]")).toContainText(
    "Квиз редактируется в Content",
  );
  const editor = page.locator('.tiptap[contenteditable="true"]');
  const before = await request.get(
    `/__local-api/authoring/materials/${saved.materialId}`,
  );
  expect(before.ok()).toBe(true);
  const snapshot = z.object({ body: z.unknown() }).parse(await before.json());
  await editor
    .locator("p")
    .filter({ hasText: "Перед тем как" })
    .first()
    .click();
  await page.keyboard.press("End");
  await page.keyboard.type(" Проверка редактора.");
  await expect
    .poll(async () => {
      const response = await request.get(
        `/__local-api/authoring/materials/${saved.materialId}`,
      );
      if (!response.ok()) return 0;
      return z
        .object({ contentVersion: z.number() })
        .parse(await response.json()).contentVersion;
    })
    .toBeGreaterThan(saved.contentVersion);
  await expect(page.getByText(/^Сохранено /u)).toBeVisible();
  const after = await request.get(
    `/__local-api/authoring/materials/${saved.materialId}`,
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
      project: testInfo.project.name,
      materialId: saved.materialId,
    }),
  );
});
