import { coverageEntrySchema } from "@inside/access-capabilities";
import { z } from "zod";
import { priceSnapshotSchema } from "./billing-contract";

export const paymentLinkSchema = z.object({
  id: z.uuid(),
  revision: z.int().positive(),
  state: z.enum([
    "active",
    "pending",
    "unknown",
    "paid",
    "revoked",
    "expired",
    "changed",
  ]),
  createdAt: z.iso.datetime({ offset: true }),
  expiresAt: z.iso.datetime({ offset: true }).nullable(),
  snapshot: priceSnapshotSchema,
});
export const paymentLinksPageSchema = z.object({
  items: z.array(paymentLinkSchema),
  nextCursor: z.uuid().nullable(),
});
export const paymentLinkDetailSchema = paymentLinkSchema.extend({
  product: coverageEntrySchema.nullable(),
});
export type PaymentLink = z.infer<typeof paymentLinkSchema>;
export type PaymentLinkDetail = z.infer<typeof paymentLinkDetailSchema>;
export const paymentLinkStateLabels: Record<PaymentLink["state"], string> = {
  active: "Готова к оплате",
  pending: "Ожидаем оплату",
  unknown: "Уточняем результат в банке",
  paid: "Покупка завершена",
  revoked: "Ссылка отозвана",
  expired: "Срок ссылки истёк",
  changed: "Условия продукта изменились",
};
export function paymentLinkHref(id: string): `/payment/links/${string}` {
  return `/payment/links/${id}`;
}
