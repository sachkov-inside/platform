import { z } from "zod";
import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import type { Subject } from "../../../content-access/index.js";
import type { LearningTaskDependencies } from "../../shared/learning-task-dependencies.js";
import { scope, systemFailure } from "../../shared/result.js";
import {
  readTaskPage,
  type ReadTaskPageError,
  type TaskPage,
} from "./read-task-page.js";
import type { Result } from "../../shared/result.js";

/** Binding lookup never substitutes the Material's access for Task authorization. */
export async function readMaterialTask(
  dependencies: LearningTaskDependencies,
  input: { readonly subject: Subject } & Readonly<Record<string, unknown>>,
): Promise<Result<TaskPage, ReadTaskPageError>> {
  const { subject, ...query } = input;
  const parsed = z.object({ materialId: z.uuid() }).strict().safeParse(query);
  if (!parsed.success)
    return { ok: false, error: { code: "invalid_request_shape" } };
  try {
    const task = await dependencies.prisma.productTask.findUnique({
      where: { embeddedMaterialId: parsed.data.materialId },
    });
    if (task?.programmeVisibility !== "embedded")
      return { ok: false, error: { code: "task_not_found" } };
    const [material] = await dependencies.directory.materialsByIds([
      parsed.data.materialId,
    ]);
    const [placement] =
      material === undefined
        ? []
        : await dependencies.directory.placements(task.productId, [
            material.sourceId,
          ]);
    if (placement?.chapterId !== task.chapterId)
      return { ok: false, error: { code: "task_not_found" } };
    const [product] = await dependencies.directory.products({
      ids: [task.productId],
    });
    if (product === undefined)
      return { ok: false, error: { code: "task_not_found" } };
    return await readTaskPage(dependencies, {
      subject,
      code: task.code,
      productSlug: product.slug,
    });
  } catch (error) {
    return dependencyFailure(
      scope("readMaterialTask"),
      error,
      systemFailure(error),
    );
  }
}
