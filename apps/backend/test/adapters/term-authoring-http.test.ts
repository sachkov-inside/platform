import { expect, test } from "vitest";
import { HttpException } from "@nestjs/common";
import {
  sourceTermSchema,
  applySourceTermBodySchema,
} from "../../src/modules/materials/features/import-source-term/import-source-term.contract.js";
import { throwTermMutationError } from "../../src/modules/materials/adapters/nest/term-authoring-http.js";

test("the authoring wire contract refuses actor identity, copied Material bodies and stale-version omissions", () => {
  const term = {
    definition: {
      id: "44300000-0000-4000-8000-000000000001",
      title: "Деплой",
      aliases: [],
      definition: "Авторский текст",
    },
    publicationState: "draft",
    source: {
      id: "content:deploy",
      path: "terms/deploy.md",
      revision: "a".repeat(64),
    },
  };
  expect(sourceTermSchema.safeParse(term).success).toBe(true);
  expect(
    sourceTermSchema.safeParse({
      ...term,
      actor: "44300000-0000-4000-8000-000000000099",
    }).success,
  ).toBe(false);
  expect(
    sourceTermSchema.safeParse({
      ...term,
      definition: { ...term.definition, body: "Protected body" },
    }).success,
  ).toBe(false);
  expect(applySourceTermBodySchema.safeParse(term).success).toBe(false);
  expect(
    applySourceTermBodySchema.safeParse({ ...term, expectedTermVersion: null })
      .success,
  ).toBe(true);
});

test("term version and source conflicts map to 409 instead of a success receipt", () => {
  expect.assertions(9);
  for (const code of [
    "term_version_conflict",
    "source_mismatch",
    "idempotency_conflict",
  ] as const) {
    try {
      throwTermMutationError({ code });
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      if (!(error instanceof HttpException)) throw error;
      expect(error.getStatus()).toBe(409);
      expect(error.getResponse()).toMatchObject({
        code,
        type: `urn:inside:problem:${code}`,
      });
    }
  }
});
