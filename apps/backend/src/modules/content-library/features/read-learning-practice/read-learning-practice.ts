import { z } from "zod";
import {
  canonicalJson,
  contractDigest,
} from "../../../../infrastructure/contracts/canonical-digest.js";
import {
  contentSha256,
  contextPart,
} from "../../../../infrastructure/contracts/context-parts.js";
import type { ContentAccess, Subject } from "../../../content-access/index.js";
import type { PublishedMaterialReader } from "../../../materials/index.js";
import { readLearningMaterial } from "../read-learning-material/read-learning-material.js";
import { practiceReviewProtocol } from "./review-protocol.js";

type Practice = Extract<
  Awaited<ReturnType<PublishedMaterialReader["readPractice"]>>,
  { ok: true }
>["value"];

export function learningPracticeContextVersion(practice: Practice): string {
  return contractDigest({
    practiceId: practice.practiceId,
    practiceVersion: practice.practiceVersion,
    definitionDigest: practice.definitionDigest,
    materialId: practice.materialId,
    contentVersion: practice.materialContentVersion,
    reviewProtocolVersion: practiceReviewProtocol.version,
  });
}

export const learningPracticeQuerySchema = z
  .object({
    practiceId: z.string().trim().min(1).max(200),
    expectedContextVersion: z.hash("sha256").optional(),
    expectedContentSha256: z.hash("sha256").optional(),
    part: z.number().int().min(0).max(100_000).default(0),
  })
  .strict()
  .refine(
    (value) =>
      value.part === 0 ||
      (value.expectedContextVersion !== undefined &&
        value.expectedContentSha256 !== undefined),
    "Later parts require expectedContextVersion and expectedContentSha256",
  );

export async function readLearningPractice(
  dependencies: {
    readonly reader: Pick<PublishedMaterialReader, "read" | "readPractice">;
    readonly contentAccess: ContentAccess;
  },
  input: {
    readonly subject: Subject;
    readonly practiceId: string;
    readonly expectedContextVersion?: string | undefined;
    readonly expectedContentSha256?: string | undefined;
    readonly part?: number;
  },
) {
  const { subject, ...query } = input;
  const parsed = learningPracticeQuerySchema.safeParse(query);
  if (!parsed.success)
    return { ok: false as const, error: { code: "invalid_request_shape" } };
  const request = parsed.data;
  const initial = await dependencies.reader.readPractice({
    subject,
    practiceId: request.practiceId,
  });
  if (!initial.ok) return initial;
  const practice = initial.value;
  const contextVersion = learningPracticeContextVersion(practice);
  if (
    request.expectedContextVersion !== undefined &&
    request.expectedContextVersion !== contextVersion
  )
    return {
      ok: false as const,
      error: {
        code: "practice_context_version_mismatch",
        expectedContextVersion: request.expectedContextVersion,
        currentContextVersion: contextVersion,
      },
    };
  const lesson = await readLearningMaterial(dependencies, {
    subject,
    slug: practice.materialSlug,
    expectedContentVersion: practice.materialContentVersion,
  });
  if (!lesson.ok) return lesson;
  const final = await dependencies.reader.readPractice({
    subject,
    practiceId: practice.practiceId,
    expectedPracticeVersion: practice.practiceVersion,
    expectedContentVersion: practice.materialContentVersion,
  });
  if (!final.ok) return final;
  if (learningPracticeContextVersion(final.value) !== contextVersion)
    return { ok: false as const, error: { code: "practice_context_changed" } };
  const serialized = canonicalJson({
    contextVersion,
    payload: {
      practice: final.value,
      reviewProtocol: practiceReviewProtocol,
      referenceLesson: lesson.value,
    },
    terminalMarker: `END_CONTEXT:${contextVersion}`,
  });
  const parts = contextPart(serialized, request.part);
  // Asset availability/presentation can change without a Material Save. Never splice two
  // rendered snapshots under the same logical context version.
  if (
    request.expectedContentSha256 !== undefined &&
    request.expectedContentSha256 !== contentSha256(serialized)
  )
    return { ok: false as const, error: { code: "practice_content_changed" } };
  if (!parts.ok)
    return {
      ok: false as const,
      error: { code: "invalid_context_part", partCount: parts.partCount },
    };
  return {
    ok: true as const,
    value: {
      practiceId: practice.practiceId,
      contextVersion,
      format: "canonical-json-parts" as const,
      ...parts.value,
    },
  };
}
