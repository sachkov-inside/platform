import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { ReadingActivityPrismaClient } from "../../../../infrastructure/prisma/index.js";
import { accountId } from "../../../accounts/index.js";
import type { ContentAccess } from "../../../content-access/index.js";
import { materialId, type MaterialContent } from "../../../materials/index.js";
import { readingOutcomeSchema } from "../../domain/reading-state.js";
import { toReadingState } from "../../shared/reading-state-mapping.js";
import { lockReadingCommand, lockReadingPair } from "./reading-locks.js";
import { setReadingStateSchema, type SetReadingStateCommand, type SetReadingStateResult } from "./set-reading-state.contract.js";

const commandSchema = setReadingStateSchema.extend({ accountId: z.uuid(), materialId: z.uuid() });

export async function setReadingState(dependencies: {
  readonly prisma: ReadingActivityPrismaClient;
  readonly contentAccess: Pick<ContentAccess, "authorize">;
  readonly materialContent: Pick<MaterialContent, "findAccessFacts">;
}, input: SetReadingStateCommand): Promise<SetReadingStateResult> {
  const parsed = commandSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: { code: "invalid_request" } };
  const command = {
    ...parsed.data,
    accountId: parsed.data.accountId.toLowerCase(),
    materialId: parsed.data.materialId.toLowerCase(),
    commandId: parsed.data.commandId.toLowerCase(),
  };
  const fingerprint = JSON.stringify(["setReadingState", command.materialId, command.isRead, command.expectedVersion]);
  try {
    return await dependencies.prisma.$transaction(async (transaction): Promise<SetReadingStateResult> => {
      // Serialize the receipt first: one command ID can target different pairs.
      await lockReadingCommand(transaction, command.accountId, command.commandId);
      const receipt = await transaction.readingCommand.findUnique({
        where: { accountId_commandId: { accountId: command.accountId, commandId: command.commandId } },
      });
      if (receipt !== null) {
        if (receipt.fingerprint !== fingerprint) return { ok: false, error: { code: "command_conflict" } };
        return { ok: true, value: { ...readingOutcomeSchema.parse(receipt.outcome), replayed: true } };
      }
      // This also covers the first write, when no state row exists to lock.
      await lockReadingPair(transaction, command.accountId, command.materialId);
      const key = { accountId: command.accountId, materialId: command.materialId };
      const row = await transaction.readingMaterialState.findUnique({ where: { accountId_materialId: key } });
      const current = toReadingState(command.materialId, row);
      if (current.version !== command.expectedVersion) return { ok: false, error: { code: "stale_version", current } };
      if (command.isRead) {
        const decision = await dependencies.contentAccess.authorize({
          subject: { kind: "account", accountId: accountId(command.accountId) },
          action: "read",
          resource: { kind: "material", materialId: materialId(command.materialId) },
          enforcementPoint: "reading_state_change",
          correlationId: command.commandId,
        });
        if (decision.effect === "deny") return {
          ok: false,
          error: { code: decision.reason === "dependency_unavailable" ? "dependency_unavailable" : "access_denied" },
        };
        const facts = await dependencies.materialContent.findAccessFacts(materialId(command.materialId));
        if (!facts.ok) return { ok: false, error: { code: "dependency_unavailable" } };
        if (facts.value === null || facts.value.publicationState !== "published" ||
          facts.value.contentVersion !== decision.checkedContentVersion ||
          ("validUntil" in decision && Date.parse(decision.validUntil) <= Date.now())) {
          return { ok: false, error: { code: "access_changed" } };
        }
      }
      const changed = current.isRead !== command.isRead;
      let state = current;
      if (changed) {
        const now = new Date();
        const values = { isRead: command.isRead, readAt: command.isRead ? now : null, version: current.version + 1, updatedAt: now };
        const saved = await transaction.readingMaterialState.upsert({
          where: { accountId_materialId: key }, create: { ...key, ...values }, update: values,
        });
        state = toReadingState(command.materialId, saved);
        await transaction.readingEvent.create({ data: {
          ...key, eventId: randomUUID(),
          eventType: command.isRead ? "material_marked_read" : "material_marked_unread",
          stateVersion: state.version, occurredAt: now, commandId: command.commandId, schemaVersion: 1,
        } });
      }
      const outcome = { state, changed };
      await transaction.readingCommand.create({ data: {
        accountId: command.accountId, commandId: command.commandId, fingerprint, outcome,
      } });
      return { ok: true, value: { ...outcome, replayed: false } };
    });
  } catch {
    return { ok: false, error: { code: "dependency_unavailable" } };
  }
}
