import { randomUUID } from "node:crypto";
import { z } from "zod";
import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import {
  Prisma,
  type ReadingActivityPrismaClient,
} from "../../../../infrastructure/prisma/index.js";
import { accountId } from "../../../accounts/index.js";
import type { ContentAccess } from "../../../content-access/index.js";
import { materialId } from "../../../materials/index.js";

/**
 * A lesson has far fewer parts; the bound only keeps a request from storing nonsense. The Reader
 * clamps a saved count to the parts the current version has.
 */
export const LESSON_OPENED_PARTS_MAX = 1000;

export const openedPartsSchema = z
  .number()
  .int()
  .min(1)
  .max(LESSON_OPENED_PARTS_MAX);

export const recordOpenedPartsBodySchema = z
  .object({ openedParts: openedPartsSchema })
  .strict();

const commandSchema = recordOpenedPartsBodySchema.extend({
  accountId: z.uuid(),
  materialId: z.uuid(),
});

export type RecordOpenedPartsResult =
  | { readonly ok: true; readonly value: { readonly openedParts: number } }
  | {
      readonly ok: false;
      readonly error: {
        readonly code:
          "invalid_request" | "access_denied" | "dependency_unavailable";
      };
    };

const storedRowSchema = z.tuple([
  z.object({ opened_parts: openedPartsSchema }).strict(),
]);

/**
 * Saves how many parts of a step-by-step lesson the Account has opened (#2122). The count only
 * grows: a late request from another tab never closes a part the reader already opened. Only a
 * reader who may read the lesson keeps a count for it.
 */
export async function recordOpenedParts(
  dependencies: {
    readonly prisma: ReadingActivityPrismaClient;
    readonly contentAccess: Pick<ContentAccess, "authorize">;
  },
  input: {
    readonly accountId: string;
    readonly materialId: string;
    readonly openedParts: number;
  },
): Promise<RecordOpenedPartsResult> {
  const parsed = commandSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: { code: "invalid_request" } };
  const command = {
    accountId: parsed.data.accountId.toLowerCase(),
    materialId: parsed.data.materialId.toLowerCase(),
    openedParts: parsed.data.openedParts,
  };
  try {
    const decision = await dependencies.contentAccess.authorize({
      subject: { kind: "account", accountId: accountId(command.accountId) },
      action: "read",
      resource: {
        kind: "material",
        materialId: materialId(command.materialId),
      },
      enforcementPoint: "lesson_parts_open",
      correlationId: randomUUID(),
    });
    if (decision.effect === "deny")
      return {
        ok: false,
        error: {
          code:
            decision.reason === "dependency_unavailable"
              ? "dependency_unavailable"
              : "access_denied",
        },
      };
    const rows: unknown = await dependencies.prisma.$queryRaw(Prisma.sql`
      insert into reading_activity.lesson_opened_parts
        (account_id, material_id, opened_parts, updated_at)
      values (
        ${command.accountId}::uuid,
        ${command.materialId}::uuid,
        ${command.openedParts},
        ${new Date()}
      )
      on conflict (account_id, material_id) do update set
        opened_parts = greatest(
          reading_activity.lesson_opened_parts.opened_parts,
          excluded.opened_parts
        ),
        updated_at = case
          when excluded.opened_parts > reading_activity.lesson_opened_parts.opened_parts
            then excluded.updated_at
          else reading_activity.lesson_opened_parts.updated_at
        end
      returning opened_parts
    `);
    const [row] = storedRowSchema.parse(rows);
    return { ok: true, value: { openedParts: row.opened_parts } };
  } catch (error) {
    return dependencyFailure(
      { module: "reading-activity", operation: "recordOpenedParts" },
      error,
      { ok: false, error: { code: "dependency_unavailable" } },
    );
  }
}
