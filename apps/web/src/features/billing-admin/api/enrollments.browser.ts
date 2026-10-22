import {
  readContentCatalogOperation,
  listSubscriptionTiersOperation,
  readTariffAssignmentsOperation,
  assignTariffAssignmentOperation,
  changeTariffAssignmentOperation,
  listActivationRulesOperation,
  saveActivationRuleOperation,
  previewEnrollmentExpansionOperation,
  applyEnrollmentExpansionOperation,
  registerSubscriptionSourceOperation,
  lookupSubscriptionRecipientOperation,
} from "./enrollments.operation";
import type { tiersOutcomeSchema } from "../model/enrollment-operations";
import type { z } from "zod";
export const listSubscriptionTiers = listSubscriptionTiersOperation.send;
export async function listAllSubscriptionTiers() {
  const items: z.infer<typeof tiersOutcomeSchema>["result"]["items"] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;
  for (;;) {
    const result = await listSubscriptionTiers({
      operationId: crypto.randomUUID(),
      limit: 100,
      ...(cursor === undefined ? {} : { cursor }),
    });
    if (!result.ok) return result;
    items.push(...result.value.result.items);
    const nextCursor = result.value.result.nextCursor;
    if (nextCursor === null)
      return {
        ok: true as const,
        value: {
          operationRef: result.value.operationRef,
          result: { outcome: "tiers" as const, items, nextCursor: null },
        },
      };
    if (seen.has(nextCursor))
      return { ok: false as const, code: "unavailable" as const };
    seen.add(nextCursor);
    cursor = nextCursor;
  }
}
export const readTariffAssignments = readTariffAssignmentsOperation.send;
export const assignTariffAssignment = assignTariffAssignmentOperation.send;
export const changeTariffAssignment = changeTariffAssignmentOperation.send;

export const listActivationRules = listActivationRulesOperation.send;

export const saveActivationRule = saveActivationRuleOperation.send;

export const previewEnrollmentExpansion =
  previewEnrollmentExpansionOperation.send;

export const applyEnrollmentExpansion = applyEnrollmentExpansionOperation.send;

export function readContentCatalog() {
  return readContentCatalogOperation.send({ operationId: crypto.randomUUID() });
}

export const registerSubscriptionSource =
  registerSubscriptionSourceOperation.send;

export const lookupSubscriptionRecipient =
  lookupSubscriptionRecipientOperation.send;
