// @ts-check
import { test } from "node:test";
import assert from "node:assert/strict";
import { productComposition } from "./product-composition.mjs";

test("repeated programme positions retain their identities independently of catalogue order", () => {
  const composition = productComposition(
    { sourceNamespace: "course" },
    {
      sourceId: "product",
      materialIds: ["lesson"],
      supplementaryMaterialIds: ["reference"],
      chapters: [
        {
          sourceId: "chapter",
          title: " Chapter ",
          summary: " Summary ",
          materialIds: ["lesson", "lesson"],
          supplementaryMaterialIds: ["reference"],
        },
      ],
    },
    {
      programmePlacements: [
        {
          id: "first",
          materialId: "lesson-id",
          chapterId: "e88161f0-5880-4eb4-acba-e74095fe3dd6",
          stepGroup: null,
        },
        {
          id: "second",
          materialId: "lesson-id",
          chapterId: "e88161f0-5880-4eb4-acba-e74095fe3dd6",
          stepGroup: null,
        },
      ],
    },
    (id) => `${id}-id`,
  );
  assert.deepEqual(composition.orderedMaterialIds, [
    "lesson-id",
    "reference-id",
  ]);
  assert.deepEqual(
    composition.programmePlacements.map(({ id }) => id),
    ["first", "second"],
  );
  assert.deepEqual(composition.chapters, [
    {
      id: "e88161f0-5880-4eb4-acba-e74095fe3dd6",
      name: "Chapter",
      summary: "Summary",
      supplementaryMaterialIds: ["reference-id"],
    },
  ]);
});

test("omitted attachment metadata preserves the receiver's attachments while an empty list clears them", () => {
  const product = {
    sourceId: "product",
    materialIds: ["lesson"],
    supplementaryMaterialIds: [],
    chapters: [
      {
        sourceId: "chapter",
        title: "Chapter",
        summary: "",
        materialIds: ["lesson"],
      },
    ],
  };
  const omitted = productComposition(
    { sourceNamespace: "course" },
    product,
    {},
    (id) => id,
  );
  assert.ok(omitted.chapters[0]);
  assert.equal("supplementaryMaterialIds" in omitted.chapters[0], false);
  const cleared = productComposition(
    { sourceNamespace: "course" },
    {
      ...product,
      chapters: product.chapters.map((chapter) => ({
        ...chapter,
        supplementaryMaterialIds: [],
      })),
    },
    {},
    (id) => id,
  );
  const clearedChapter = cleared.chapters[0];
  assert.ok(clearedChapter && "supplementaryMaterialIds" in clearedChapter);
  assert.deepEqual(clearedChapter.supplementaryMaterialIds, []);
});

test("a flat programme keeps an existing position and excludes catalogue-only Materials", () => {
  const composition = productComposition(
    { sourceNamespace: "course" },
    {
      sourceId: "product",
      materialIds: ["lesson"],
      supplementaryMaterialIds: ["reference"],
      chapters: [],
    },
    {
      programmePlacements: [
        {
          id: "existing",
          materialId: "lesson",
          chapterId: null,
          stepGroup: null,
        },
      ],
    },
    (id) => id,
  );
  assert.deepEqual(composition.programmePlacements, [
    { id: "existing", materialId: "lesson", chapterId: null, stepGroup: null },
  ]);
  assert.deepEqual(composition.orderedMaterialIds, ["lesson", "reference"]);
});
