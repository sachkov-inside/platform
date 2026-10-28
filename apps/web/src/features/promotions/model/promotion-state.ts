import type { AdminStateKey } from "@/shared/ui/admin";

import type { PromotionListItem } from "./promotion-operations";

export type PromotionState =
  "active" | "scheduled" | "ended" | "exhausted" | "archived";

/**
 * Состояние скидки на момент чтения списка. Архив важнее всего; затем окончание срока, затем
 * исчерпанный лимит применений; скидка до начала запланирована, иначе она действует. Период
 * полуоткрыт, как у сервера: `startsAt` включительно, `endsAt` уже нет.
 */
export function promotionState(
  promotion: Pick<
    PromotionListItem,
    "archived" | "startsAt" | "endsAt" | "usageLimit" | "usedCount"
  >,
  now: Date,
): PromotionState {
  if (promotion.archived) return "archived";
  const at = now.getTime();
  if (at >= Date.parse(promotion.endsAt)) return "ended";
  if (
    promotion.usageLimit !== null &&
    promotion.usedCount >= promotion.usageLimit
  )
    return "exhausted";
  if (at < Date.parse(promotion.startsAt)) return "scheduled";
  return "active";
}

export function promotionBadge(state: PromotionState): AdminStateKey {
  return `promotion.${state}`;
}

/** Изменить и архивировать можно действующую запись владельца новой области. */
export function isPromotionEditable(promotion: PromotionListItem): boolean {
  return !promotion.archived && !promotion.legacy && !promotion.questionnaire;
}
