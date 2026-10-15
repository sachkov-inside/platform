import { z } from "zod";

/** Continuation keeps the owning payment and append-only PostgreSQL sequence together. */
export const paymentAuditCursorSchema: z.ZodObject<{
  purchaseRef: z.ZodUUID;
  afterSequence: z.ZodString;
}, z.core.$strict> = z.strictObject({
  purchaseRef: z.uuid().toLowerCase(),
  afterSequence: z.string().regex(/^[1-9][0-9]{0,18}$/),
});
export const PAYMENT_AUDIT_PAGE_SIZE = 100;
