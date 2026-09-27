// @ts-check
// Isolated full-stack seed through real author APIs; never used by production or the shared stand.
import { z } from "zod";
import { convertMarkdown } from "../tools/authoring/markdown.mjs";
const receipt = z.object({ materialId: z.uuid(), contentVersion: z.number() });

/** @param {string} origin @param {string} accessToken */
export async function seedFullStackPractice(origin, accessToken) {
  /** @param {string} path @param {unknown} [body] */
  const request = async (path, body) => {
    const response = await fetch(`${origin}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
        "idempotency-key": `fullstack-practice-${path}`,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok)
      throw new Error(
        `Synthetic practice seed ${path}: HTTP ${response.status}; ${JSON.stringify(await response.json())}`,
      );
    return /** @type {unknown} */ (await response.json());
  };
  const source = {
    id: "synthetic:fullstack-practice",
    path: "practice.md",
    revision: "a".repeat(64),
    showInFeed: false,
  };
  const guide = z
    .object({ id: z.uuid() })
    .parse(
      await request("/authoring/import/guides/reserve", {
        sourceId: "synthetic:fullstack-practice-guide",
        name: "Synthetic practice",
        slug: "synthetic-practice",
        summary: "Isolated imported practice fixture",
      }),
    );
  const reserved = receipt.parse(
    await request("/authoring/import/materials/reserve", { source }),
  );
  const saved = receipt.parse(
    await request("/authoring/import/materials/apply", {
      source,
      materialId: reserved.materialId,
      expectedContentVersion: reserved.contentVersion,
      publicationState: "published",
      primaryVideoId: null,
      metadata: {
        title: "Synthetic practice reference",
        summary: "Isolated Reader and authorization fixture",
        access: "membership",
        topicId: "72000000-0000-4000-8000-000000000002",
        formatId: "guide",
        tagIds: [],
        seriesIds: [guide.id],
        difficulty: null,
        outcomes: [],
      },
      body: convertMarkdown(
        "FULLSTACK_PRIVATE_PRACTICE_BODY: business requests, state, duplicates and ownership.",
        {
          sourceId: source.id,
          sourcePath: source.path,
          link: (href) => href,
          image: (href) => href,
        },
      ),
    }),
  );
  await request("/authoring/import/practices/apply", {
    practiceId: "synthetic:fullstack-practice",
    materialId: saved.materialId,
    expectedContentVersion: saved.contentVersion,
    expectedPracticeVersion: null,
    publicationState: "published",
    sourceReference: {
      materialSourceId: source.id,
      materialSourceRevision: source.revision,
    },
    provenance: {
      repository: "synthetic/fullstack",
      commit: "b".repeat(40),
      path: "practice.json",
    },
    definition: {
      schemaVersion: 1,
      title: "Бриф консультаций",
      businessInputs: "Участник видит только свою заявку.",
      expectedOutcome: "Самостоятельный бриф.",
      allowedFreedom: "Любой формат документа.",
      criteria: [
        {
          id: "ownership",
          requirement: "Чужая заявка не раскрывается.",
          acceptableEvidence: ["Явное бизнес-ограничение."],
        },
      ],
    },
  });
  const material = z
    .object({ metadata: z.object({ slug: z.string() }) })
    .parse(await request(`/authoring/materials/${saved.materialId}`));
  return {
    slug: material.metadata.slug,
    practiceId: "synthetic:fullstack-practice",
  };
}
