import { z } from "zod";
import { loadPackage } from "../../authoring/package.mjs";
import { convertMarkdown, sourceUuid } from "../../authoring/markdown.mjs";
import { renderMaterialBlocks } from "@inside/material-blocks";
import { refusingLearnerMcpDependencies } from "../../../apps/backend/test/fixtures/learner-mcp.js";
import {
  practiceDefinitionDigest,
  practiceDefinitionSchema,
} from "../../../apps/backend/src/modules/materials/domain/practice-definition.js";

// Synthetic Materials/ContentAccess ports, real conversion/rendering and learner composition.
import type { LearnerMcpDependencies } from "../../../apps/backend/src/modules/content-library/index.js";
type Practice = Extract<
  Awaited<ReturnType<LearnerMcpDependencies["reader"]["readPractice"]>>,
  { ok: true }
>["value"];
type Available = Extract<
  Extract<
    Awaited<ReturnType<LearnerMcpDependencies["reader"]["read"]>>,
    { ok: true }
  >["value"],
  { kind: "available" }
>;
export async function packageDependencies(
  packagePath: string,
): Promise<LearnerMcpDependencies> {
  const { manifest } = await loadPackage(packagePath);
  const defaults = refusingLearnerMcpDependencies();
  const entries = new Map<string, { practice: Practice; lesson: Available }>();
  for (const practice of manifest.practiceDefinitions ?? []) {
    const material = manifest.materials.find(
      (row) =>
        `${manifest.sourceNamespace}:${row.sourceId}` ===
        practice.sourceReference.materialSourceId,
    );
    if (material === undefined) throw Error("Missing source material");
    const document = convertMarkdown(material.markdown, {
      sourcePath: material.sourcePath,
      sourceId: material.sourceId,
      link: (href) => href,
      image: () => {
        throw Error("Media requires explicit fixture adapter");
      },
    });
    const blocks = z.array(z.json()).parse(document.doc.content);
    const definition = practiceDefinitionSchema.parse(practice.definition);
    const materialId = sourceUuid(material.sourceId);
    const slug = material.sourceId.replaceAll(":", "-");
    const value: Practice = {
      practiceId: practice.practiceId,
      practiceVersion: 1,
      definitionDigest: practiceDefinitionDigest(
        definition,
        practice.sourceReference,
      ),
      definition,
      materialId,
      materialSlug: slug,
      materialContentVersion: 1,
      sourceReference: practice.sourceReference,
      provenance: practice.provenance,
    };
    const projection: Available["projection"] = {
      materialId,
      contentVersion: 1,
      slug,
      title: material.title,
      summary: material.summary,
      difficulty: material.difficulty,
      outcomes: material.outcomes ?? [],
      access: "free",
      publishedAt: "2026-09-27T00:00:00Z",
      primaryVideoId: null,
      cover: null,
      topic: { id: "topic", name: "Topic", slug: "topic" },
      format: { id: "guide", name: "Guide", slug: "guide" },
      tags: [],
      seriesMemberships: [],
    };
    entries.set(practice.practiceId, {
      practice: value,
      lesson: {
        kind: "available",
        cacheScope: "private-no-store",
        primaryVideo: null,
        projection,
        body: { schemaVersion: 1, blocks: renderMaterialBlocks(blocks) },
      },
    });
  }
  return {
    ...defaults,
    reader: {
      ...defaults.reader,
      readPractice: (query) => {
        const entry = entries.get(query.practiceId);
        if (entry === undefined)
          return Promise.resolve({
            ok: false,
            error: { code: "practice_not_available" },
          });
        if (
          (query.expectedPracticeVersion !== undefined &&
            query.expectedPracticeVersion !== 1) ||
          (query.expectedContentVersion !== undefined &&
            query.expectedContentVersion !== 1)
        )
          return Promise.resolve({
            ok: false,
            error: { code: "practice_not_available" },
          });
        return Promise.resolve({ ok: true, value: entry.practice });
      },
      read: (query) => {
        const entry = [...entries.values()].find(
          (row) => row.lesson.projection.slug === query.slug,
        );
        return Promise.resolve(
          entry !== undefined
            ? { ok: true, value: entry.lesson }
            : { ok: false, error: { code: "material_not_found" } },
        );
      },
    },
    contentAccess: {
      ...defaults.contentAccess,
      authorize: () =>
        Promise.resolve({
          effect: "allow",
          reason: "public_resource",
          checkedContentVersion: 1,
          policyVersion: "content-access-v1",
          decisionId: "fixture",
          decidedAt: "2026-09-27T00:00:00Z",
        }),
    },
  };
}
