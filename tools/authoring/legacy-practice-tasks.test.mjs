// @ts-check
import { manifestSchema } from "./package.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { migratePracticeRequirements } from "./legacy-practice-tasks.mjs";

/** @returns {import('./package.mjs').Manifest} */
function fixture() {
  return manifestSchema.parse({
    schemaVersion: 1,
    sourceNamespace: "fixture",
    selection: {
      productId: "course",
      chapterIds: ["chapter"],
      materialIds: ["lesson"],
      complete: true,
    },
    products: [
      {
        sourceId: "course",
        title: "Course",
        summary: "",
        complete: true,
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
      },
    ],
    materials: [
      {
        sourceId: "lesson",
        access: "free",
        sourcePath: "lesson.md",
        sourceIds: [],
        relatedMaterialIds: [],
        readingTimeMinutes: null,
        kind: "guide",
        title: "Lesson",
        summary: "Lesson",
        stage: "draft",
        showInFeed: false,
        difficulty: null,
        outcomes: [],
        markdown: "Lesson",
        links: {},
        images: {},
        coverAssetId: null,
        coverAlt: null,
        video: null,
        videoChapters: [],
        artifacts: [],
        topicId: null,
      },
    ],
    assets: [],
    diagnostics: [],
    practiceDefinitions: [
      {
        practiceId: "fixture:requirements",
        definition: {
          schemaVersion: 1,
          title: "Original title",
          businessInputs: "Situation",
          expectedOutcome: "Я".repeat(16000),
          allowedFreedom: "Freedom",
          criteria: [
            {
              id: "requirement",
              requirement: "Original requirement",
              acceptableEvidence: ["Evidence"],
            },
          ],
        },
        sourceReference: {
          materialSourceId: "fixture:lesson",
          materialSourceRevision: "a".repeat(64),
        },
        provenance: {
          repository: "fixture/source",
          commit: "b".repeat(40),
          path: "original.json",
        },
        publicationState: "unpublished",
      },
    ],
  });
}

test("legacy package requirements become one source-bound embedded Task without mutating source bytes or inventing authored prose", () => {
  const original = fixture(),
    snapshot = structuredClone(original);
  const converted = migratePracticeRequirements(original);
  assert.deepEqual(original, snapshot);
  assert.deepEqual(converted.practiceDefinitions, []);
  assert.equal(converted.tasks?.length, 1);
  assert.deepEqual(converted.tasks?.[0], {
    sourceId: "requirements",
    productId: "course",
    chapterId: "chapter",
    title: "Original title",
    access: "free",
    definition: {
      schemaVersion: 1,
      situation: "Situation",
      result: ["Я".repeat(16000)],
      freedom: "Freedom",
      criteria: [
        {
          id: "requirement",
          level: "required",
          requirement: "Original requirement",
          acceptableEvidence: ["Evidence"],
        },
      ],
    },
    relatedMaterialIds: ["lesson"],
    programmeVisibility: "embedded",
    publicationState: "unpublished",
    provenance: snapshot.practiceDefinitions?.[0]?.provenance,
  });
  assert.equal(converted.materials[0]?.practiceTaskId, "requirements");
});

test("zero or multiple owners and existing Task bindings fail before import instead of guessing identity", () => {
  for (const configure of [
    /** @param {import('./package.mjs').Manifest} manifest */ (manifest) => {
      manifest.products = [];
    },
    /** @param {import('./package.mjs').Manifest} manifest */ (manifest) => {
      if (manifest.products[0])
        manifest.products.push(structuredClone(manifest.products[0]));
    },
    /** @param {import('./package.mjs').Manifest} manifest */ (manifest) => {
      if (manifest.materials[0])
        manifest.materials[0].practiceTaskId = "accepted-task";
    },
  ]) {
    const manifest = fixture();
    configure(manifest);
    assert.throws(() => migratePracticeRequirements(manifest), /binding/u);
  }
});
