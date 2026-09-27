import type { AccessGrants } from "../../membership-entitlements/index.js";
import type { OfferEligibility } from "../domain/pricing.js";

/** Основания Account, по которым Offer допускает к покупке. У гостя оснований нет. */
export interface PurchaseGrounds {
  readonly formerTributeSubscriber: boolean;
}
export type PurchaseGroundsReader = Pick<AccessGrants, "readPurchaseGrounds">;

export const noPurchaseGrounds: PurchaseGrounds = {
  formerTributeSubscriber: false,
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
    ? { formerTributeSubscriber: result.formerTributeSubscriber }
    : null;
}

/** Допускает ли Offer Account с этими основаниями. Прежний снимок без допуска открыт всем. */
export function offerAdmits(
  eligibility: OfferEligibility | undefined,
  grounds: PurchaseGrounds,
): boolean {
  switch (eligibility ?? "everyone") {
    case "everyone":
      return true;
    case "former_tribute_subscribers":
      return grounds.formerTributeSubscriber;
  }
}
