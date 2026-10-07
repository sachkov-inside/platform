import { randomUUID } from "node:crypto";
import { z } from "zod";

import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import type { Subject } from "../../../content-access/index.js";
import type { DirectoryProduct } from "../../../materials/index.js";
import type { LearningTaskDependencies } from "../../shared/learning-task-dependencies.js";
import {
  scope,
  systemFailure,
  type Result,
  type SystemError,
} from "../../shared/result.js";

// The catalogue holds a few dozen tasks; the bound only stops a runaway list.
const MAX_TASKS = 500;
const ACCESS_BATCH = 100;

export const learningTasksQuerySchema = z
  .object({ productSlug: z.string().min(1).max(120).optional() })
  .strict();

export interface LearningTaskSummary {
  readonly code: string;
  readonly title: string;
  readonly product: { readonly slug: string; readonly name: string };
  readonly chapter: { readonly name: string; readonly ordinal: number };
  /** Order of the task inside its chapter, from 1. */
  readonly position: number;
  readonly currentVersion: number;
  /** The subject's own latest submission of this task, if any. */
  readonly lastSubmittedAt: string | null;
}

export type ListLearningTasksError =
  { readonly code: "invalid_request_shape" } | SystemError;

/** Published tasks the subject can open, in programme order: Product, chapter, order in chapter. */
export async function listLearningTasks(
  dependencies: LearningTaskDependencies,
  input: {
    readonly subject: Subject;
    readonly productSlug?: string | undefined;
  },
): Promise<
  Result<
    { readonly tasks: readonly LearningTaskSummary[] },
    ListLearningTasksError
  >
> {
  const { subject, ...query } = input;
  const parsed = learningTasksQuerySchema.safeParse(query);
  if (!parsed.success)
    return { ok: false, error: { code: "invalid_request_shape" } };
  try {
    let productFilter: readonly DirectoryProduct[] | undefined;
    if (parsed.data.productSlug !== undefined) {
      productFilter = await dependencies.directory.products({
        slugs: [parsed.data.productSlug],
      });
      if (productFilter.length === 0) return { ok: true, value: { tasks: [] } };
    }
    const rows = await dependencies.prisma.productTask.findMany({
      where: {
        publicationState: "published",
        ...(productFilter === undefined
          ? {}
          : { productId: { in: productFilter.map((product) => product.id) } }),
      },
      orderBy: [{ position: "asc" }, { code: "asc" }],
      take: MAX_TASKS,
    });
    const open = new Set<string>();
    for (let start = 0; start < rows.length; start += ACCESS_BATCH) {
      const batch = rows.slice(start, start + ACCESS_BATCH);
      const availability =
        await dependencies.contentAccess.checkAvailabilityMany({
          subject,
          operations: batch.map((row) => ({
            itemId: row.id,
            resource: { kind: "productTask" as const, taskId: row.id },
            action: "read" as const,
          })),
          enforcementPoint: "product_task_read",
          correlationId: randomUUID(),
        });
      if (!availability.ok) throw new Error(availability.error.code);
      for (const item of availability.items)
        if (item.availability === "available") open.add(item.itemId);
    }
    const visible = rows.filter((row) => open.has(row.id));
    const productIds = [...new Set(visible.map((row) => row.productId))];
    const products = new Map<string, DirectoryProduct>();
    for (let start = 0; start < productIds.length; start += ACCESS_BATCH)
      for (const product of await dependencies.directory.products({
        ids: productIds.slice(start, start + ACCESS_BATCH),
      }))
        products.set(product.id, product);
    const lastSubmissions =
      subject.kind === "account" && visible.length > 0
        ? await dependencies.prisma.productTaskSubmission.groupBy({
            by: ["taskId"],
            where: {
              accountId: subject.accountId,
              taskId: { in: visible.map((row) => row.id) },
            },
            _max: { submittedAt: true },
          })
        : [];
    const lastByTask = new Map(
      lastSubmissions.map((row) => [row.taskId, row._max.submittedAt]),
    );
    const tasks = visible.flatMap((row): LearningTaskSummary[] => {
      const product = products.get(row.productId);
      const chapter = product?.chapters.find(
        (item) => item.id === row.chapterId,
      );
      if (product === undefined || product.archived || chapter === undefined)
        return [];
      return [
        {
          code: row.code,
          title: row.title,
          product: { slug: product.slug, name: product.name },
          chapter: { name: chapter.name, ordinal: chapter.ordinal },
          position: row.position,
          currentVersion: row.currentVersion,
          lastSubmittedAt: lastByTask.get(row.id)?.toISOString() ?? null,
        },
      ];
    });
    tasks.sort((left, right) => {
      const order = [
        left.product.name.localeCompare(right.product.name),
        left.product.slug.localeCompare(right.product.slug),
        left.chapter.ordinal - right.chapter.ordinal,
        left.position - right.position,
        left.code.localeCompare(right.code),
      ];
      return order.find((difference) => difference !== 0) ?? 0;
    });
    return { ok: true, value: { tasks } };
  } catch (error) {
    return dependencyFailure(
      scope("listLearningTasks"),
      error,
      systemFailure(error),
    );
  }
}
