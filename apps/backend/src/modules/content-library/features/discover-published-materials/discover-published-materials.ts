import { z } from "zod";

import type { ContentAccess } from "../../../content-access/index.js";
import type { LearningTasks } from "../../../guide-tasks/index.js";
import type { PublishedMaterialReader } from "../../../materials/index.js";
import type { Videos } from "../../../videos/index.js";
import { projectPublishedCatalogItems } from "../../shared/project-published-catalog-items.js";
import type {
  DiscoverPublishedMaterialsQuery,
  GuideChapterTaskDto,
  PublishedMaterialDiscoveryResult,
} from "./discover-published-materials.contract.js";

const querySchema = z
  .object({
    first: z.number().int().min(0).max(10_000).nullable(),
    kind: z.enum(["related", "series", "topic"]),
    slug: z.string().min(1).max(120),
    subject: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("anonymous") }).strict(),
      z.object({ kind: z.literal("account"), accountId: z.uuid() }).strict(),
    ]),
  })
  .strict()
  .refine(({ first, kind }) => first !== null || kind === "series", {
    path: ["first"],
    message: "Only complete Series discovery may omit a page size",
  })
  .refine(
    ({ first, kind }) => kind !== "related" || (first !== null && first > 0),
    {
      path: ["first"],
      message: "Related Material discovery requires a positive page size",
    },
  );

/**
 * A generated catalog view. A Guide programme also places its published tasks in chapters when the
 * caller passes `tasks`; a caller that only needs the main path, such as the series continuation,
 * leaves it out and every chapter then lists no tasks.
 */
export async function discoverPublishedMaterials(
  publishedMaterialReader: Pick<PublishedMaterialReader, "discoverProjections">,
  contentAccess: Pick<ContentAccess, "checkAvailabilityMany">,
  videos: Pick<Videos, "loadReadyDurations">,
  query: DiscoverPublishedMaterialsQuery,
  tasks?: Pick<LearningTasks, "chapterTasks">,
): Promise<PublishedMaterialDiscoveryResult> {
  const parsed = querySchema.safeParse(query);
  if (!parsed.success) {
    return { ok: false, error: { code: "invalid_request_shape" } };
  }
  const page = await publishedMaterialReader.discoverProjections({
    first: parsed.data.first,
    kind: parsed.data.kind,
    slug: parsed.data.slug,
  });
  if (!page.ok) {
    return page;
  }
  const tasksByChapter = new Map<string, GuideChapterTaskDto[]>();
  if (
    tasks !== undefined &&
    parsed.data.kind === "series" &&
    page.value.chapters.length > 0
  ) {
    const listed = await tasks.chapterTasks({
      subject: query.subject,
      guideId: page.value.reference.id,
    });
    if (!listed.ok)
      return {
        ok: false,
        error:
          listed.error.code === "internal_error"
            ? listed.error
            : { code: "dependency_unavailable", retryable: true },
      };
    for (const task of listed.value.tasks) {
      const chapterTasks = tasksByChapter.get(task.chapterId) ?? [];
      chapterTasks.push({
        code: task.code,
        title: task.title,
        access: task.access,
        afterMaterialId: task.afterMaterialId,
        availability: task.availability,
        lastSubmittedAt: task.lastSubmittedAt,
      });
      tasksByChapter.set(task.chapterId, chapterTasks);
    }
  }
  const projected = await projectPublishedCatalogItems(
    contentAccess,
    videos,
    query.subject,
    page.value.items,
  );
  return projected.ok
    ? {
        ok: true,
        value: {
          chapters: page.value.chapters.map((chapter) => ({
            id: chapter.id,
            materialIds: chapter.materialIds,
            name: chapter.name,
            summary: chapter.summary,
            tasks: tasksByChapter.get(chapter.id) ?? [],
          })),
          hasNext: page.value.hasNext,
          items: projected.items,
          kind: page.value.kind,
          reference: page.value.reference,
          relatedSeries: page.value.relatedSeries,
          topics: page.value.topics,
        },
      }
    : projected;
}
