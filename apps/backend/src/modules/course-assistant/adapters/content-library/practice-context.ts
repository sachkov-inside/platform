import { createHash } from "node:crypto";
import { z } from "zod";
import { reportDependencyFailure } from "../../../../infrastructure/observability/index.js";
import { accountId } from "../../../accounts/index.js";
import type { ContentAccess } from "../../../content-access/index.js";
import {
  learningPracticeContextVersion,
  readLearningPractice,
} from "../../../content-library/index.js";
import type { PublishedMaterialReader } from "../../../materials/index.js";
import type {
  PracticeContextFailure,
  PracticeContextSource,
} from "../../ports/practice-context.js";

/** Больше частей — не учебное задание: чтение не продолжается. */
const contextPartLimit = 200;

const contextSchema = z.object({
  contextVersion: z.hash("sha256"),
  payload: z.object({
    practice: z.object({
      practiceId: z.string(),
      definition: z.object({
        title: z.string(),
        criteria: z.array(
          z.object({ id: z.string(), requirement: z.string() }),
        ),
      }),
    }),
    reviewProtocol: z.object({
      version: z.string(),
      instructions: z.array(z.string()),
    }),
  }),
});

/**
 * Контекст задания только через публичные операции Materials и ContentLibrary из #785/#782:
 * ContentAccess решает доступ Account, contextVersion и целостность частей проверяет сама операция.
 */
export function assemblePracticeContextSource(dependencies: {
  readonly reader: Pick<PublishedMaterialReader, "read" | "readPractice">;
  readonly contentAccess: ContentAccess;
}): PracticeContextSource {
  const subject = (id: string) =>
    ({ kind: "account", accountId: accountId(id) }) as const;
  return {
    async describe({ accountId: account, practiceId }) {
      const read = await dependencies.reader.readPractice({
        subject: subject(account),
        practiceId,
      });
      if (!read.ok) return failure("describePracticeContext", read.error);
      const practice = read.value;
      return {
        ok: true,
        value: {
          practiceId: practice.practiceId,
          contextVersion: learningPracticeContextVersion(practice),
          title: practice.definition.title,
          criteria: practice.definition.criteria.map(({ id, requirement }) => ({
            id,
            requirement,
          })),
        },
      };
    },
    async read({ accountId: account, practiceId, expectedContextVersion }) {
      let serialized = "";
      let contentSha256: string | undefined;
      for (let part = 0; part < contextPartLimit; part += 1) {
        const read = await readLearningPractice(dependencies, {
          subject: subject(account),
          practiceId,
          expectedContextVersion,
          ...(contentSha256 === undefined
            ? {}
            : { expectedContentSha256: contentSha256 }),
          part,
        });
        if (!read.ok) return failure("readPracticeContext", read.error);
        contentSha256 = read.value.contentSha256;
        serialized += read.value.data;
        if (read.value.endOfContext) break;
      }
      // Каждая часть уже сверена со своим отпечатком; целиком контекст сверяется ещё раз.
      if (
        contentSha256 === undefined ||
        createHash("sha256").update(serialized).digest("hex") !== contentSha256
      )
        return failure("readPracticeContext", {
          code: "practice_content_changed",
        });
      const context = contextSchema.parse(JSON.parse(serialized));
      const { practice, reviewProtocol } = context.payload;
      return {
        ok: true,
        value: {
          practiceId: practice.practiceId,
          contextVersion: context.contextVersion,
          title: practice.definition.title,
          criteria: practice.definition.criteria.map(({ id, requirement }) => ({
            id,
            requirement,
          })),
          reviewProtocol,
          data: serialized,
        },
      };
    },
  };
}

function failure(
  operation: string,
  error: { readonly code: string; readonly currentContextVersion?: unknown },
): { readonly ok: false } & PracticeContextFailure {
  switch (error.code) {
    case "practice_context_version_mismatch":
      return typeof error.currentContextVersion === "string"
        ? {
            ok: false,
            reason: "context_version_mismatch",
            currentContextVersion: error.currentContextVersion,
          }
        : { ok: false, reason: "dependency_unavailable" };
    case "invalid_request_shape":
    case "practice_not_available":
    case "material_not_available":
      return { ok: false, reason: "practice_unavailable" };
    default:
      // Контекст сменился между частями или хранилище недоступно: повтор даст ответ.
      reportDependencyFailure(
        { module: "course-assistant", operation },
        new Error(`Practice context read failed: ${error.code}`),
      );
      return { ok: false, reason: "dependency_unavailable" };
  }
}
