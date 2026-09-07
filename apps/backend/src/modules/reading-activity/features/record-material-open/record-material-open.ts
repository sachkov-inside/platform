import { z } from "zod";
import type { ReadingActivityPrismaClient } from "../../../../infrastructure/prisma/index.js";
import { accountId } from "../../../accounts/index.js";
import { materialId, type MaterialContent } from "../../../materials/index.js";
import type { ContentAccess } from "../../../content-access/index.js";
import { lockReadingCommand, lockReadingPair } from "../set-reading-state/reading-locks.js";
export const recordMaterialOpenSchema = z.object({ materialId: z.uuid(), contentVersion: z.number().int().positive(), commandId: z.uuid() }).strict();
const openReceiptSchema = z.object({ openedAt: z.iso.datetime() }).strict();
export type RecordMaterialOpenInput = z.infer<typeof recordMaterialOpenSchema> & { readonly accountId: string };
export type RecordMaterialOpenResult =
  | { readonly ok: true; readonly value: { readonly openedAt: string; readonly replayed: boolean } }
  | { readonly ok: false; readonly error: { readonly code: "invalid_request" | "command_conflict" | "access_changed" | "access_denied" | "dependency_unavailable" } };
export async function recordMaterialOpen(dependencies: {
  readonly prisma: ReadingActivityPrismaClient;
  readonly contentAccess: Pick<ContentAccess, "authorize">;
  readonly materialContent: Pick<MaterialContent, "findAccessFacts">;
}, input: RecordMaterialOpenInput): Promise<RecordMaterialOpenResult> {
  const parsed = recordMaterialOpenSchema.extend({ accountId: z.uuid() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: { code: "invalid_request" } };
  const command = { ...parsed.data, accountId: parsed.data.accountId.toLowerCase(), materialId: parsed.data.materialId.toLowerCase(), commandId: parsed.data.commandId.toLowerCase() };
  const fingerprint = JSON.stringify(["recordMaterialOpen", command.materialId, command.contentVersion]);
  try {
    return await dependencies.prisma.$transaction(async (transaction): Promise<RecordMaterialOpenResult> => {
      await lockReadingCommand(transaction, command.accountId, command.commandId);
      const receipt = await transaction.readingCommand.findUnique({ where: { accountId_commandId: { accountId: command.accountId, commandId: command.commandId } } });
      if (receipt !== null) {
        if (receipt.fingerprint !== fingerprint) return { ok: false, error: { code: "command_conflict" } };
        return { ok: true, value: { ...openReceiptSchema.parse(receipt.outcome), replayed: true } };
      }
      await lockReadingPair(transaction, command.accountId, command.materialId);
      const decision = await dependencies.contentAccess.authorize({ subject: { kind: "account", accountId: accountId(command.accountId) }, action: "read", resource: { kind: "material", materialId: materialId(command.materialId) }, enforcementPoint: "material_open", correlationId: command.commandId });
      if (decision.effect === "deny") return { ok: false, error: { code: decision.reason === "dependency_unavailable" ? "dependency_unavailable" : "access_denied" } };
      const facts = await dependencies.materialContent.findAccessFacts(materialId(command.materialId));
      if (!facts.ok) return { ok: false, error: { code: "dependency_unavailable" } };
      if (facts.value === null || facts.value.publicationState !== "published" || facts.value.contentVersion !== command.contentVersion || decision.checkedContentVersion !== command.contentVersion || ("validUntil" in decision && Date.parse(decision.validUntil) <= Date.now())) return { ok: false, error: { code: "access_changed" } };
      const now = new Date();
      const pair = { accountId: command.accountId, materialId: command.materialId };
      const visit = await transaction.readingMaterialVisit.upsert({ where: { accountId_materialId: pair }, create: { ...pair, firstOpenedAt: now, lastOpenedAt: now }, update: { lastOpenedAt: now } });
      const outcome = { openedAt: visit.lastOpenedAt.toISOString() };
      await transaction.readingCommand.create({ data: { accountId: command.accountId, commandId: command.commandId, fingerprint, outcome } });
      return { ok: true, value: { ...outcome, replayed: false } };
    });
  } catch { return { ok: false, error: { code: "dependency_unavailable" } }; }
}
