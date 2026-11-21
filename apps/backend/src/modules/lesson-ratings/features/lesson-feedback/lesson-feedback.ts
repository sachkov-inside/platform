import { randomUUID } from "node:crypto";
import { z } from "zod";

import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import { accountId } from "../../../accounts/index.js";
import { deniedMaterialRead } from "../../../content-access/index.js";
import { materialId } from "../../../materials/index.js";
import type {
  RateLessonDependencies,
  RateLessonError,
} from "../rate-lesson/rate-lesson.js";

const ownerSchema = z.object({
  accountId: z.uuid().toLowerCase(),
  materialId: z.uuid().toLowerCase(),
});
export const feedbackBodySchema = z.strictObject({
  text: z
    .string()
    .trim()
    .min(1)
    .max(2000)
    .refine((text) => !text.includes("\0")),
});

type FeedbackResult =
  | { readonly ok: true; readonly submitted: boolean }
  | { readonly ok: false; readonly error: RateLessonError };

export async function lessonFeedback(
  dependencies: RateLessonDependencies,
  input: { readonly accountId: string; readonly materialId: string },
  body?: z.infer<typeof feedbackBodySchema>,
): Promise<FeedbackResult> {
  const owner = ownerSchema.safeParse(input);
  if (!owner.success) return { ok: false, error: { code: "invalid_request" } };
  try {
    const decision = await dependencies.contentAccess.authorize({
      subject: { kind: "account", accountId: accountId(owner.data.accountId) },
      action: "read",
      resource: {
        kind: "material",
        materialId: materialId(owner.data.materialId),
      },
      enforcementPoint: "lesson_feedback",
      correlationId: randomUUID(),
    });
    if (decision.effect === "deny")
      return {
        ok: false,
        error: { code: deniedMaterialRead(decision.reason) },
      };

    if (body === undefined) {
      const existing = await dependencies.prisma.lessonFeedback.findUnique({
        where: { accountId_materialId: owner.data },
        select: { id: true },
      });
      return { ok: true, submitted: existing !== null };
    }

    await dependencies.prisma.lessonFeedback.createMany({
      data: {
        ...owner.data,
        id: randomUUID(),
        text: body.text,
        submittedAt: new Date(),
      },
      skipDuplicates: true,
    });
    return { ok: true, submitted: true };
  } catch (error) {
    return dependencyFailure(
      { module: "lesson-ratings", operation: "lessonFeedback" },
      error,
      { ok: false, error: { code: "dependency_unavailable" } },
    );
  }
}
