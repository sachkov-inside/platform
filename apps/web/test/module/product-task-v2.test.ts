import { describe, expect, it } from "vitest";

import {
  ownTaskSubmissionsSchema,
  productTaskPageSchema,
} from "@/_pages/product-task/model/product-task-page";

function page() {
  return {
    access: "open",
    task: {
      code: "synthetic-task",
      title: "Название из YAML",
      product: { slug: "synthetic-course", name: "Тестовый курс" },
      chapter: { name: "Первая глава", ordinal: 1 },
      access: "free",
      version: 2,
      page: {
        title: "Задание 1. Название страницы",
        summary: "Описание",
        body: { schemaVersion: 1, blocks: [] },
        cover: null,
        artifacts: [],
      },
      definition: {
        schemaVersion: 2,
        format: "c",
        intro: "Вступление",
        freedom: "Выбери стек",
        criteria: [
          {
            id: "first",
            level: "required",
            task: "Собери проект",
            explanation: "[Урок](/materials/lesson)",
            advice: "Начни с одного шага",
          },
        ],
      },
    },
    reviewProtocol: { version: "3", instructions: [] },
    relatedMaterials: [],
    submission: { accepting: true },
  };
}

describe("Product Task c reader contract (#1194)", () => {
  it("accepts separate authored criteria, explanation and advice without agent evidence", () => {
    const parsed = productTaskPageSchema.safeParse(page());
    expect(parsed.success).toBe(true);
  });

  it("accepts historical c criteria without disclosing agent evidence", () => {
    const criteria = page().task.definition.criteria;
    expect(
      ownTaskSubmissionsSchema.safeParse({
        code: "synthetic-task",
        currentVersion: 2,
        versions: [{ version: 2, criteria }],
        submissions: [],
      }).success,
    ).toBe(true);
    expect(
      ownTaskSubmissionsSchema.safeParse({
        code: "synthetic-task",
        currentVersion: 2,
        versions: [
          {
            version: 2,
            criteria: criteria.map((criterion) => ({
              ...criterion,
              acceptableEvidence: ["Hidden"],
            })),
          },
        ],
        submissions: [],
      }).success,
    ).toBe(false);
  });

  it("refuses agent evidence in the c reader response", () => {
    const value = page();
    value.task.definition.criteria = value.task.definition.criteria.map(
      (criterion) => ({ ...criterion, acceptableEvidence: ["Hidden"] }),
    );
    expect(productTaskPageSchema.safeParse(value).success).toBe(false);
  });
});
