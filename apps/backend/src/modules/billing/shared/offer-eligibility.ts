import type { AccessGrants } from "../../membership-entitlements/index.js";
import type { OfferEligibility } from "../domain/pricing.js";

/** Основания Account, по которым Offer допускает к покупке. У гостя оснований нет. */
export interface PurchaseGrounds {
  readonly formerTributeSubscriber: boolean;
  /** Offer, к которым Account допущен погашёнными приглашениями. */
  readonly invitedOfferIds: readonly string[];
}
export type PurchaseGroundsReader = Pick<AccessGrants, "readPurchaseGrounds">;

export const noPurchaseGrounds: PurchaseGrounds = {
  formerTributeSubscriber: false,
  invitedOfferIds: [],
};

/**
 * Основания Account для допуска к Offer; `null` — прочитать их не удалось. Без читателя оснований
 * процесс не может подтвердить ни одно основание и допускает только к Offer для всех.
 */
export async function readPurchaseGrounds(
  reader: PurchaseGroundsReader | undefined,
  accountId: string | undefined,
): Promise<PurchaseGrounds | null> {
  if (reader === undefined || accountId === undefined) return noPurchaseGrounds;
  const result = await reader.readPurchaseGrounds(accountId);
  return result.ok
    ? {
        formerTributeSubscriber: result.formerTributeSubscriber,
        invitedOfferIds: result.invitedOfferIds,
      }
    : null;
}

/**
 * Допускает ли Offer Account с этими основаниями. Прежний снимок без допуска открыт всем. Допуск по
 * приглашению привязан к id Offer и не зависит от его последующих изменений.
 */
export function offerAdmits(
  offer: {
    readonly id: string;
    readonly eligibility?: OfferEligibility | undefined;
  },
  grounds: PurchaseGrounds,
): boolean {
  switch (offer.eligibility ?? "everyone") {
    case "everyone":
      return true;
    case "former_tribute_subscribers":
      return grounds.formerTributeSubscriber;
    case "invitation_only":
      return grounds.invitedOfferIds.includes(offer.id);
  }
}
