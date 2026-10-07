import { z } from "zod";

import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import type { Subject } from "../../../content-access/index.js";
import { taskReviewProtocol } from "../../domain/review-protocol.js";
import {
  taskCodeSchema,
  type TaskDefinition,
} from "../../domain/task-definition.js";
import {
  decideTaskAccess,
  findCurrentTask,
  readRelatedMaterials,
  type LearningTaskDependencies,
} from "../../shared/learning-task-dependencies.js";
import {
  scope,
  systemFailure,
  type Result,
  type SystemError,
} from "../../shared/result.js";

export const taskPageQuerySchema = z
  .object({
    productSlug: z
      .string()
      .max(120)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u),
    code: taskCodeSchema,
  })
  .strict();

interface TaskPlace {
  readonly code: string;
  readonly title: string;
  readonly product: { readonly slug: string; readonly name: string };
  readonly chapter: { readonly name: string; readonly ordinal: number };
}

/**
 * What the task page shows. An open task carries its current requirements, the review procedure
 * v3 that MCP returns too, related Materials and whether submission is open; a closed one shows
 * only where it stands, like a closed Material (owner, 05.10.2026).
 */
export type TaskPage =
  | {
      readonly access: "open";
      readonly task: TaskPlace & {
        readonly access: "free" | "closed";
        readonly version: number;
        readonly definition: TaskDefinition;
      };
      readonly reviewProtocol: typeof taskReviewProtocol;
      readonly relatedMaterials: readonly {
        readonly slug: string;
        readonly title: string;
        readonly availability: "available" | "locked" | "unavailable";
      }[];
      readonly submission: { readonly accepting: boolean };
    }
  | { readonly access: "closed"; readonly task: TaskPlace };

export type ReadTaskPageError =
  | { readonly code: "invalid_request_shape" }
  | { readonly code: "task_not_found" }
  | SystemError;

/**
 * One task of one Product for its page. A code of another Product, an archived Product and an
 * unpublished task the subject cannot open are not found, so the page answers 404 for them.
 */
export async function readTaskPage(
  dependencies: LearningTaskDependencies,
  input: { readonly subject: Subject } & Readonly<Record<string, unknown>>,
): Promise<Result<TaskPage, ReadTaskPageError>> {
  const { subject, ...query } = input;
  const parsed = taskPageQuerySchema.safeParse(query);
  if (!parsed.success)
    return { ok: false, error: { code: "invalid_request_shape" } };
  try {
    const task = await findCurrentTask(dependencies.prisma, parsed.data.code);
    if (task === null) return notFound();
    const [product] = await dependencies.directory.products({
      ids: [task.productId],
    });
    const chapter = product?.chapters.find(
      (item) => item.id === task.chapterId,
    );
    if (
      product === undefined ||
      product.archived ||
      product.slug !== parsed.data.productSlug ||
      chapter === undefined
    )
      return notFound();
    const access = await decideTaskAccess(
      dependencies.contentAccess,
      subject,
      task.id,
      "product_task_read",
    );
    if (access === "unavailable")
      return {
        ok: false,
        error: { code: "dependency_unavailable", retryable: true },
      };
    const place: TaskPlace = {
      code: task.code,
      title: task.title,
      product: { slug: product.slug, name: product.name },
      chapter: { name: chapter.name, ordinal: chapter.ordinal },
    };
    if (access === "closed")
      return task.publicationState === "published"
        ? { ok: true, value: { access: "closed", task: place } }
        : notFound();
    return {
      ok: true,
      value: {
        access: "open",
        task: {
          ...place,
          access: task.access,
          version: task.version,
          definition: task.definition,
        },
        reviewProtocol: taskReviewProtocol,
        relatedMaterials: await readRelatedMaterials(
          dependencies,
          subject,
          task.relatedMaterialSourceIds,
        ),
        submission: { accepting: dependencies.submissionsEnabled },
      },
    };
  } catch (error) {
    return dependencyFailure(
      scope("readTaskPage"),
      error,
      systemFailure(error),
    );
  }
}

function notFound(): { readonly ok: false; readonly error: ReadTaskPageError } {
  return { ok: false, error: { code: "task_not_found" } };
}
