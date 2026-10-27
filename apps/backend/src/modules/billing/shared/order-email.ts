import { z } from "zod";
import type { Tbank } from "../infrastructure/tbank/tbank.js";

const orderContactSchema = z.object({ emailCiphertext: z.string() });

/** Заказ хранит запечатанный адрес; историческая запись без него остаётся без адреса. */
export function hasSealedOrderEmail(contact: unknown): boolean {
  return orderContactSchema.safeParse(contact).success;
}

/**
 * Неизменный адрес заказа из `purchases.contact`. Адрес запечатан ключом привязки банка для
 * своего заказа, поэтому открывается только тем же адаптером банка. Ошибка не содержит адреса:
 * её текст не повторяет ни шифртекст, ни расшифрованное значение.
 */
export function openOrderEmail(
  bank: Pick<Tbank, "openBinding">,
  purchaseRef: string,
  contact: unknown,
): string {
  const parsed = orderContactSchema.safeParse(contact);
  if (!parsed.success) throw new Error("Order contact has no sealed email");
  // A wrong key or another terminal fails AES-GCM authentication; that error names no input.
  const opened = bank.openBinding(
    `${purchaseRef}:contact`,
    parsed.data.emailCiphertext,
  );
  const email = z.email().safeParse(opened);
  if (!email.success) throw new Error("Order email is malformed");
  return email.data;
}
