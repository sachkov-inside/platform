import { z } from "zod";

/**
 * Email заказа: адрес для чека, который покупатель указал при оплате. Отдельное чтение владельца
 * только для страницы платежа; в список, поиск, журналы и MCP он не попадает.
 */
export const orderEmailSchema = z.object({ email: z.email().nullable() });
export type OrderEmail = z.infer<typeof orderEmailSchema>;

/** Ключ личного чтения: не делит кеш со списком и страницей платежа и не живёт дольше показа. */
export function orderEmailQueryKey(purchaseRef: string) {
  return ["owner-payments", "order-email", purchaseRef.toLowerCase()] as const;
}
