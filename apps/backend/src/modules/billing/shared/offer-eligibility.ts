import type { OfferEligibility } from "../domain/pricing.js";

/** Основания Account, по которым Offer допускает к покупке. У гостя оснований нет. */
export interface PurchaseGrounds {
  readonly formerTributeSubscriber: boolean;
  /** Offer, к которым Account допущен погашёнными приглашениями. */
  readonly invitedOfferIds: readonly string[];
}
export const noPurchaseGrounds: PurchaseGrounds = {
  formerTributeSubscriber: false,
  invitedOfferIds: [],
};

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
