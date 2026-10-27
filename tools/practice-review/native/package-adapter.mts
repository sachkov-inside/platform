import { z } from "zod";
import { loadPackage } from "../../authoring/package.mjs";
import { convertMarkdown, sourceUuid } from "../../authoring/markdown.mjs";
import { renderMaterialBlocks } from "@inside/material-blocks";
import { refusingLearnerMcpDependencies } from "../../../apps/backend/test/fixtures/learner-mcp.js";
import type { LearnerMcpDependencies } from "../../../apps/backend/src/modules/content-library/index.js";
import { syntheticLearningTasks } from "./task-adapter.mjs";

/** Explicit synthetic Tasks use the production serializer and complete version-pinned Material
 * context. No legacy Practice read or importer is part of the current native review matrix. */
export async function packageDependencies(
  packagePath: string,
): Promise<LearnerMcpDependencies> {
  const { manifest } = await loadPackage(packagePath);
  const defaults = refusingLearnerMcpDependencies();
  const entries = new Map<string, ReturnType<typeof syntheticLearningTasks>>();
  for (const task of manifest.tasks ?? []) {
    const material = manifest.materials.find((row) =>
      task.relatedMaterialIds.includes(row.sourceId),
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
    entries.set(
      task.sourceId,
      syntheticLearningTasks({
        code: task.sourceId,
        definition: task.definition,
        practice: {
          materialId: sourceUuid(material.sourceId),
          contentVersion: 1,
          slug: material.sourceId,
          title: material.title,
          body: { schemaVersion: 1, blocks: renderMaterialBlocks(blocks) },
        },
      }),
    );
  }
  return {
    ...defaults,
    tasks: {
      ...defaults.tasks,
      read: (query) => {
        const entry =
          typeof query["code"] === "string"
            ? entries.get(query["code"])
            : undefined;
        return entry === undefined
          ? defaults.tasks.read(query)
          : entry.tasks.read(query);
      },
    },
  };
}
