import { z } from "zod";

/** Адрес заказа для владельца; `null`, когда у заказа нет запечатанного адреса. */
export const ownerOrderEmailSchema = z.strictObject({
  email: z.email().nullable(),
});
export type OwnerOrderEmail = z.infer<typeof ownerOrderEmailSchema>;
