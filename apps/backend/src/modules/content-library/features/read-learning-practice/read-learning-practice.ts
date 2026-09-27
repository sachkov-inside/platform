import { z } from "zod";
import {
  canonicalJson,
  contractDigest,
} from "../../../../infrastructure/contracts/canonical-digest.js";
import { createHash } from "node:crypto";
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
  const contentSha256 = createHash("sha256").update(serialized).digest("hex");
  // Asset availability/presentation can change without a Material Save. Never splice two
  // rendered snapshots under the same logical context version.
  if (
    request.expectedContentSha256 !== undefined &&
    request.expectedContentSha256 !== contentSha256
  )
    return { ok: false as const, error: { code: "practice_content_changed" } };
  // Small bounded tool responses avoid native client output truncation. Splitting by Unicode
  // code point preserves every character; clients must consume all parts, not only the last.
  const characters = Array.from(serialized);
  const partSize = 6_000;
  const partCount = Math.ceil(characters.length / partSize);
  if (request.part >= partCount)
    return {
      ok: false as const,
      error: { code: "invalid_context_part", partCount },
    };
  const data = characters
    .slice(request.part * partSize, (request.part + 1) * partSize)
    .join("");
  return {
    ok: true as const,
    value: {
      practiceId: practice.practiceId,
      contextVersion,
      format: "canonical-json-parts" as const,
      contentSha256,
      contentBytes: Buffer.byteLength(serialized, "utf8"),
      part: request.part,
      partCount,
      data,
      partSha256: createHash("sha256").update(data).digest("hex"),
      complete: partCount === 1,
      endOfContext: request.part === partCount - 1,
      nextPart: request.part === partCount - 1 ? null : request.part + 1,
    },
  };
}
