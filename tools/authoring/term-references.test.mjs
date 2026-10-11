// @ts-check
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  parseTermWikiReference,
  prepareTermReferences,
} from "./term-references.mjs";

const deploy = {
  id: "44300000-0000-4000-8000-000000000001",
  title: "Деплой",
  aliases: ["развёртывание", "deploy"],
  definition:
    "Развёртывание выбранной версии приложения в конкретном окружении — например, на тестовом сервере",
};

test("two materials can resolve different authored phrases to one stable term", () => {
  const resolve = prepareTermReferences([
    { definition: deploy, publicationState: "published", available: true },
  ]);
  assert.deepEqual(resolve("Деплой"), {
    kind: "term",
    termId: "44300000-0000-4000-8000-000000000001",
  });
  assert.deepEqual(resolve("развёртывание"), {
    kind: "term",
    termId: "44300000-0000-4000-8000-000000000001",
  });
});

test("duplicate stable IDs stop reference preparation before any reference is used", () => {
  assert.throws(
    () =>
      prepareTermReferences([
        { definition: deploy, publicationState: "published", available: true },
        {
          definition: { ...deploy, title: "Другой деплой" },
          publicationState: "published",
          available: true,
        },
      ]),
    /Duplicate term ID/u,
  );
});

test("an ambiguous alias fails instead of choosing the last definition", () => {
  const resolve = prepareTermReferences([
    { definition: deploy, publicationState: "published", available: true },
    {
      definition: {
        ...deploy,
        id: "44300000-0000-4000-8000-000000000002",
        title: "Другой термин",
        aliases: ["DEPLOY"],
      },
      publicationState: "published",
      available: true,
    },
  ]);
  assert.throws(() => resolve("deploy"), /Ambiguous term/u);
});

test("an explicit stable ID disambiguates overlapping aliases", () => {
  const resolve = prepareTermReferences([
    { definition: deploy, publicationState: "published", available: true },
    {
      definition: {
        ...deploy,
        id: "44300000-0000-4000-8000-000000000002",
      },
      publicationState: "published",
      available: true,
    },
  ]);
  assert.deepEqual(resolve("term:44300000-0000-4000-8000-000000000001"), {
    kind: "term",
    termId: "44300000-0000-4000-8000-000000000001",
  });
});

test("a target the author cannot read is refused even when its definition is known", () => {
  const resolve = prepareTermReferences([
    { definition: deploy, publicationState: "published", available: false },
  ]);
  assert.throws(() => resolve("Деплой"), /Inaccessible term/u);
});

test("a public body cannot reference an unpublished definition", () => {
  const resolve = prepareTermReferences([
    { definition: deploy, publicationState: "unpublished", available: true },
  ]);
  assert.throws(() => resolve("Деплой"), /Unpublished term/u);
});

test("a wiki reference preserves an authored phrase independently of the target", () => {
  assert.deepEqual(
    parseTermWikiReference("Через [[Деплой|развёртывание]].", 6),
    {
      target: "Деплой",
      text: "развёртывание",
      end: 30,
    },
  );
});

test("unsupported wiki forms stop instead of silently losing part of the phrase", () => {
  for (const source of [
    "[[Деплой",
    "[[]]",
    "[[Деплой|]]",
    "[[Деплой|текст|другой текст]]",
    "[[Деплой#Раздел]]",
    "[[Деплой^блок]]",
    "[[Деплой\n|слово]]",
    "[[[Деплой]]]",
  ]) {
    assert.throws(
      () => parseTermWikiReference(source, 0),
      /term wiki reference/u,
    );
  }
});

test("a missing target is refused without substituting an ordinary URL", () => {
  const resolve = prepareTermReferences([
    { definition: deploy, publicationState: "published", available: true },
  ]);
  assert.throws(() => resolve("Неизвестный термин"), /Missing term/u);
});

test("an authoring preview may retain a draft reference without copying its definition", () => {
  const resolve = prepareTermReferences(
    [{ definition: deploy, publicationState: "draft", available: true }],
    { allowUnpublished: true },
  );
  assert.deepEqual(resolve("Деплой"), {
    kind: "term",
    termId: "44300000-0000-4000-8000-000000000001",
  });
});

test("an authoring preview cannot override an inaccessible target", () => {
  const resolve = prepareTermReferences(
    [{ definition: deploy, publicationState: "draft", available: false }],
    { allowUnpublished: true },
  );
  assert.throws(() => resolve("Деплой"), /Inaccessible term/u);
});

test("label lookup normalizes Unicode and case without changing the visible phrase", () => {
  const resolve = prepareTermReferences([
    { definition: deploy, publicationState: "published", available: true },
  ]);
  const parsed = parseTermWikiReference(
    "[[ разве\u0308ртывание | другое слово ]]",
    0,
  );
  assert.equal(parsed?.text, "другое слово");
  assert.deepEqual(resolve(parsed?.target ?? ""), {
    kind: "term",
    termId: "44300000-0000-4000-8000-000000000001",
  });
});

test("a repeated alias of one definition is not ambiguous", () => {
  const resolve = prepareTermReferences([
    {
      definition: {
        ...deploy,
        aliases: ["деплой", "Деплой", "DEPLOY", "deploy"],
      },
      publicationState: "published",
      available: true,
    },
  ]);
  assert.deepEqual(resolve("deploy"), {
    kind: "term",
    termId: "44300000-0000-4000-8000-000000000001",
  });
});

test("ordinary Markdown links are outside the wiki token grammar", () => {
  assert.equal(
    parseTermWikiReference("[Первый деплой](../deploy.md)", 0),
    undefined,
  );
  assert.deepEqual(parseTermWikiReference("[[Деплой]]", 0), {
    target: "Деплой",
    text: "Деплой",
    end: 10,
  });
});
