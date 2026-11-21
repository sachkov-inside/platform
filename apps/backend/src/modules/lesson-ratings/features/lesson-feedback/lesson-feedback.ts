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

export interface LessonFeedbackPolicy {
  readonly enabled: boolean;
  readonly hasActiveLessonPlacement: (
    materialId: string,
  ) => Promise<
    { readonly ok: true; readonly value: boolean } | { readonly ok: false }
  >;
}

type FeedbackOwner = z.infer<typeof ownerSchema>;
type Dependencies = RateLessonDependencies & {
  readonly feedbackPolicy: LessonFeedbackPolicy;
};

export function readLessonFeedback(
  dependencies: Dependencies,
  input: FeedbackOwner,
) {
  return withLessonAccess(
    dependencies,
    input,
    "readLessonFeedback",
    async (owner) => {
      const existing = await dependencies.prisma.lessonFeedback.findUnique({
        where: { accountId_materialId: owner },
        select: { id: true },
      });
      return existing !== null;
    },
  );
}

export function submitLessonFeedback(
  dependencies: Dependencies,
  input: FeedbackOwner,
  body: unknown,
) {
  const parsed = feedbackBodySchema.safeParse(body);
  if (!parsed.success)
    return Promise.resolve<FeedbackResult>({
      ok: false,
      error: { code: "invalid_request" },
    });
  return withLessonAccess(
    dependencies,
    input,
    "submitLessonFeedback",
    async (owner) => {
      await dependencies.prisma.lessonFeedback.createMany({
        data: {
          ...owner,
          id: randomUUID(),
          text: parsed.data.text,
          submittedAt: new Date(),
        },
        skipDuplicates: true,
      });
      return true;
    },
  );
}

async function withLessonAccess(
  dependencies: Dependencies,
  input: FeedbackOwner,
  operation: "readLessonFeedback" | "submitLessonFeedback",
  execute: (owner: FeedbackOwner) => Promise<boolean>,
): Promise<FeedbackResult> {
  const owner = ownerSchema.safeParse(input);
  if (!owner.success) return { ok: false, error: { code: "invalid_request" } };
  if (!dependencies.feedbackPolicy.enabled)
    return { ok: false, error: { code: "material_not_found" } };
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

    const lesson = await dependencies.feedbackPolicy.hasActiveLessonPlacement(
      owner.data.materialId,
    );
    if (!lesson.ok)
      return { ok: false, error: { code: "dependency_unavailable" } };
    if (!lesson.value)
      return { ok: false, error: { code: "material_not_found" } };
    return { ok: true, submitted: await execute(owner.data) };
  } catch (error) {
    return dependencyFailure({ module: "lesson-ratings", operation }, error, {
      ok: false,
      error: { code: "dependency_unavailable" },
    });
  }
}
