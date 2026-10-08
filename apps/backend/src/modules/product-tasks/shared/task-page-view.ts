import type { RenderedMaterialBody } from "@inside/material-blocks";
import {
  taskPageBodySchema,
  renderTaskBody,
  type StoredTaskPage,
} from "../domain/task-page.js";
import type { TaskDefinition } from "../domain/task-definition.js";
import type {
  CurrentTask,
  LearningTaskDependencies,
} from "./learning-task-dependencies.js";

export interface TaskPageView {
  readonly title: string;
  readonly summary: string;
  readonly body: RenderedMaterialBody;
  readonly cover: { readonly assetId: string; readonly alt: string } | null;
  readonly artifacts: readonly {
    readonly sourceId: string;
    readonly title: string;
    readonly assetId: string;
  }[];
}

export function taskAssetUrl(
  productSlug: string,
  code: string,
  assetId: string,
): string {
  return `/library/products/${productSlug}/tasks/${code}/assets/${assetId}`;
}

/** Source links resolve at read time, so the authored definition stays environment independent. */
export async function taskPageView(
  dependencies: LearningTaskDependencies,
  task: CurrentTask,
  productSlug: string,
): Promise<{ definition: TaskDefinition; page?: TaskPageView }> {
  const page = task.page;
  if (page === null) return { definition: task.definition };
  const urls = await resolveTaskLinks(dependencies, page);
  const destinations = new Map(urls);
  for (const [address, image] of Object.entries(page.resolvedImages))
    destinations.set(
      address,
      taskAssetUrl(productSlug, task.code, image.assetId),
    );
  const markdown = (text: string): string =>
    resolveMarkdownLinks(text, destinations);
  const definition =
    task.definition.schemaVersion === 1
      ? task.definition
      : {
          ...task.definition,
          intro: markdown(task.definition.intro),
          freedom: markdown(task.definition.freedom),
          criteria: task.definition.criteria.map((criterion) => ({
            ...criterion,
            task: markdown(criterion.task),
            explanation: markdown(criterion.explanation),
            ...(criterion.advice === undefined
              ? {}
              : { advice: markdown(criterion.advice) }),
            acceptableEvidence: criterion.acceptableEvidence.map(markdown),
          })),
        };
  // Tools converted pageBody before Task identities existed. Rebind authored local destinations here.
  const body = JSON.parse(
    JSON.stringify(page.body),
    (key: string, value: unknown): unknown => {
      if (key !== "href" || typeof value !== "string") return value;
      return urls.get(value) ?? value;
    },
  ) as unknown;
  const parsedBody = page.body;
  // Validate the transformed snapshot again through the public Materials codec.
  const rendered = renderTaskBody({ ...parsedBody, doc: parseBodyDoc(body) });
  const cover =
    typeof page.source.coverAssetId === "string"
      ? (page.resolvedImages[`cover:${page.source.coverAssetId}`] ??
        page.resolvedImages[page.source.coverAssetId])
      : undefined;
  return {
    definition,
    page: {
      title: page.source.title,
      summary: page.source.summary,
      body: rendered,
      cover:
        cover === undefined
          ? null
          : { assetId: cover.assetId, alt: page.source.coverAlt ?? "" },
      artifacts: (page.source.artifacts ?? []).flatMap((artifact) => {
        const asset =
          page.resolvedImages[`artifact:${artifact.sourceId}`] ??
          page.resolvedImages[artifact.assetId];
        return asset === undefined
          ? []
          : [
              {
                sourceId: artifact.sourceId,
                title: artifact.title,
                assetId: asset.assetId,
              },
            ];
      }),
    },
  };
}

/** Rebind destinations, including reference definitions, without rewriting literal code examples. */
function resolveMarkdownLinks(
  text: string,
  destinations: ReadonlyMap<string, string | null>,
): string {
  return text
    .split(/(```[\s\S]*?```|~~~[\s\S]*?~~~|``[^`\n]*``|`[^`\n]*`)/gu)
    .map((part, index) => {
      if (index % 2 === 1) return part;
      let resolved = part;
      for (const [address, target] of destinations) {
        if (target === null) continue;
        const escaped = address.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
        resolved = resolved.replace(
          new RegExp(`\\]\\((?:<${escaped}>|${escaped})(?=[\\s)])`, "gu"),
          () => `](${target}`,
        );
      }
      return resolved.replace(
        /(^[ \t]{0,3}\[[^\]\n]+\]:[ \t]*)(<[^>\n]+>|[^\s]+)/gmu,
        (whole: string, prefix: string, destination: string) => {
          const address = destination.startsWith("<")
            ? destination.slice(1, -1)
            : destination;
          const target = destinations.get(address);
          return target === undefined || target === null
            ? whole
            : `${prefix}${target}`;
        },
      );
    })
    .join("");
}

function parseBodyDoc(value: unknown) {
  return taskPageBodySchema.parse(value).doc;
}

async function resolveTaskLinks(
  dependencies: LearningTaskDependencies,
  page: StoredTaskPage,
) {
  const ids = [...new Set(Object.values(page.resolvedLinks))];
  const materials = new Map(
    (await dependencies.directory.materialsBySource(ids)).map((item) => [
      item.sourceId,
      item,
    ]),
  );
  const tasks = await dependencies.prisma.productTask.findMany({
    where: { sourceId: { in: ids }, publicationState: "published" },
  });
  const products = new Map(
    (
      await dependencies.directory.products({
        ids: [...new Set(tasks.map((item) => item.productId))],
      })
    ).map((item) => [item.id, item]),
  );
  const urls = new Map<string, string | null>();
  for (const [address, sourceId] of Object.entries(page.resolvedLinks)) {
    const fragmentIndex = address.indexOf("#");
    const fragment = fragmentIndex === -1 ? "" : address.slice(fragmentIndex);
    const material = materials.get(sourceId);
    if (material?.published !== null && material?.published !== undefined) {
      urls.set(address, `/materials/${material.published.slug}${fragment}`);
      continue;
    }
    const target = tasks.find((item) => item.sourceId === sourceId);
    const product =
      target === undefined ? undefined : products.get(target.productId);
    // A published closed Task can be linked: its own page enforces access and shows only its place.
    urls.set(
      address,
      target === undefined || product === undefined || product.archived
        ? null
        : `/products/${product.slug}/tasks/${target.code}${fragment}`,
    );
  }
  return urls;
}
