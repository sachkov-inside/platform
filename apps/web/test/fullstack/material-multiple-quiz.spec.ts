import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import {
  fullStackBrowserRequest,
  signInFullStack,
} from "../support/full-stack-session";
import { z } from "zod";

test("multiple-answer quiz survives real document admission, published Reader and reload", async ({
  context,
  page,
}) => {
  const { readerBlocksSchema } = await import("@inside/material-blocks");
  const { convertMarkdown } =
    await import("../../../../tools/authoring/markdown.mjs");
  await signInFullStack(context, "OWNER");
  await page.goto("/account");
  const suffix = randomUUID();
  const slug = `multiple-quiz-${suffix}`;
  const body = convertMarkdown("Raw source is not the Reader body", {
    sourceId: `quiz:${suffix}`,
    sourcePath: "fixtures/multiple-quiz.md",
    link: (href) => href,
    image: () => suffix,
    readerBlocks: readerBlocksSchema.parse([
      { kind: "markdown", markdown: "## Первая версия" },
      {
        kind: "quiz",
        id: "features",
        selectionMode: "multiple",
        promptMarkdown: "Выбери возможности первой версии.",
        correctOptionIds: ["accounts", "projects", "github", "agent"],
        options: [
          "accounts",
          "projects",
          "github",
          "agent",
          "cloud",
          "budgets",
          "rag",
          "teams",
        ].map((id) => ({
          id,
          markdown: `Возможность ${id}`,
          explanationMarkdown: `Объяснение ${id}`,
        })),
        dontKnow: {
          explanationMarkdown: "Первую версию расширим позже.",
          reviewLinks: ["#первая-версия"],
        },
      },
    ]),
  });
  const created = await fullStackBrowserRequest(
    page,
    "/api/authoring/materials",
    "POST",
    {
      title: `Multiple quiz ${suffix}`,
      summary: "Synthetic multiple-answer quiz admission.",
      access: "free",
      difficulty: "basic",
      formatId: "guide",
      // The isolated full-stack seed owns this Platform topic.
      topicId: "72000000-0000-4000-8000-000000000002",
      submissionId: randomUUID(),
      seriesIds: "[]",
      document: JSON.stringify(body.doc),
    },
  );
  const draft = z
    .object({
      kind: z.literal("created"),
      draft: z.object({ materialId: z.uuid(), contentVersion: z.number() }),
    })
    .parse(await created.json());
  const published = await fullStackBrowserRequest(
    page,
    "/api/authoring/materials",
    "PATCH",
    {
      materialId: draft.draft.materialId,
      expectedContentVersion: String(draft.draft.contentVersion),
      publicationState: "published",
      submissionId: randomUUID(),
    },
  );
  expect(await published.json()).toMatchObject({ kind: "saved" });
  const response = await page.goto(`/materials/${slug}`);
  expect(response?.status()).toBe(200);
  const quiz = page.locator("[data-material-quiz]");
  await expect(quiz.getByRole("checkbox")).toHaveCount(8);
  await expect(quiz.getByRole("button", { name: "Проверить" })).toBeDisabled();
  await expect(quiz.getByText("Объяснение accounts")).toHaveCount(0);
  for (const id of ["accounts", "projects", "github", "agent"])
    await quiz
      .getByRole("checkbox", { name: `Возможность ${id}`, exact: true })
      .check();
  await quiz.getByRole("button", { name: "Проверить" }).click();
  await expect(quiz.getByText("Правильно", { exact: true })).toBeVisible();
  await expect(quiz.getByText("Объяснение teams")).toBeVisible();
  await quiz
    .getByRole("checkbox", { name: "Возможность teams", exact: true })
    .check();
  await expect(quiz.getByText("Правильно", { exact: true })).toHaveCount(0);
  await expect(quiz.getByText("Объяснение accounts")).toHaveCount(0);
  await quiz.getByRole("button", { name: "Проверить" }).click();
  await expect(quiz.getByText("Пока неверно", { exact: true })).toBeVisible();
  await expect(
    quiz.getByText("Возможность accounts", { exact: true }),
  ).toHaveCount(1);
  expect(
    (await new AxeBuilder({ page }).include("[data-material-quiz]").analyze())
      .violations,
  ).toEqual([]);
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth ===
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
  await page.reload();
  await expect(quiz.getByRole("checkbox")).toHaveCount(8);
  await expect(quiz.getByRole("checkbox").first()).not.toBeChecked();
  await expect(quiz.getByRole("button", { name: "Проверить" })).toBeDisabled();
  await expect(quiz.locator("[data-quiz-feedback]")).toHaveCount(0);
});
