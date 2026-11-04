import { externalRead } from "../../database/external-reads.js";

export const PRODUCT_ACCESS = Symbol("PRODUCT_ACCESS");
export type ProductAccessResult =
  | { readonly status: "ok"; readonly withAccess: readonly string[] }
  | { readonly status: "unavailable" };
/** Platform's answer: which Telegram identities belong to an Account with Product Access. */
export interface ProductAccess {
  read(telegramIdentityRefs: readonly string[]): Promise<ProductAccessResult>;
}
/** Without the Platform endpoint nobody is known to have access, so marketing is not narrowed. */
export class UnknownProductAccess implements ProductAccess {
  read(): Promise<ProductAccessResult> {
    return Promise.resolve({ status: "ok", withAccess: [] });
  }
}
/** One identity's access, read outside the transaction that asks for it. */
export async function productAccessOf(
  provider: ProductAccess,
  telegramIdentityRef: string,
): Promise<"access" | "none" | "unavailable"> {
  const result = await externalRead(
    `product-access:${telegramIdentityRef}`,
    () => provider.read([telegramIdentityRef]),
  );
  if (result.status === "unavailable") return "unavailable";
  return result.withAccess.includes(telegramIdentityRef) ? "access" : "none";
}
