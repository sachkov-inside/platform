import { randomUUID } from "node:crypto";

import type { MaterialsPrismaTransaction } from "../../../infrastructure/prisma/index.js";
import type { HeldGuideRemoval } from "../facets/material-authoring/material-authoring.contract.js";
import type { GuideAccessHolders } from "../ports/guide-access-holders.js";

/**
 * Руководства с держателями права, из которых операция убирает опубликованный материал. Снятие
 * из руководства без держателей подтверждения не требует: купленного там никто не теряет.
 */
export async function heldGuideRemovals(
  transaction: MaterialsPrismaTransaction,
  holders: GuideAccessHolders | undefined,
  guideIds: readonly string[],
): Promise<readonly HeldGuideRemoval[]> {
  if (holders === undefined || guideIds.length === 0) return [];
  const unique = [...new Set(guideIds)];
  const counts = await holders.countGuideHolders(unique);
  const held = unique.filter((guideId) => (counts.get(guideId) ?? 0) > 0);
  if (held.length === 0) return [];
  const guides = await transaction.guide.findMany({
    where: { id: { in: held } },
    select: { id: true, name: true },
  });
  return held.map((guideId) => ({
    guideId,
    holders: counts.get(guideId) ?? 0,
    name: guides.find(({ id }) => id === guideId)?.name ?? "",
  }));
}

/** Какие из затронутых руководств команда ещё не подтвердила. */
export function unconfirmedGuideRemovals(
  removals: readonly HeldGuideRemoval[],
  confirmedGuideIds: readonly string[],
): readonly HeldGuideRemoval[] {
  return removals.filter(({ guideId }) => !confirmedGuideIds.includes(guideId));
}

/** Запись подтверждённого снятия: одна строка на пару «руководство — материал». */
export async function recordGuideRemovals(
  transaction: MaterialsPrismaTransaction,
  values: {
    readonly actor: string;
    readonly operation: "material_save" | "guide_composition";
    readonly removals: readonly { readonly guide: HeldGuideRemoval; readonly materialId: string }[];
    readonly removedAt: Date;
  },
): Promise<void> {
  if (values.removals.length === 0) return;
  await transaction.guideMaterialRemoval.createMany({
    data: values.removals.map(({ guide, materialId }) => ({
      actorAccountId: values.actor,
      guideId: guide.guideId,
      holders: guide.holders,
      id: randomUUID(),
      materialId,
      operation: values.operation,
      removedAt: values.removedAt,
    })),
  });
}
