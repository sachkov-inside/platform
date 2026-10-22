import { z } from "zod";

import { defineMutationOperation } from "@/shared/api/mutation-operation";

import { waitlistMutationSchema } from "../model/product-waitlist-response";

const productInput = z.object({ productId: z.uuid() });
const unavailable = () => ({ kind: "unavailable" }) as const;

/** Where the reader came from; an unknown or malformed source is dropped, not refused. */
const sourceSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/u)
  .nullable()
  .catch(null);

/** Starts joining a Product waitlist; a guest is sent to sign in first. */
export const beginWaitlistIntentOperation = defineMutationOperation({
  input: productInput.extend({ source: sourceSchema.optional() }),
  method: "POST",
  path: "/api/product-waitlist/intent",
  result: waitlistMutationSchema,
  transportFailure: unavailable,
});

/** Joins the waitlist the signed-in reader started. */
export const joinWaitlistOperation = defineMutationOperation({
  input: productInput,
  method: "POST",
  path: "/api/product-waitlist/join",
  result: waitlistMutationSchema,
  transportFailure: unavailable,
});

/** Leaves a Product waitlist. */
export const withdrawWaitlistOperation = defineMutationOperation({
  input: productInput,
  method: "POST",
  path: "/api/product-waitlist/withdraw",
  result: waitlistMutationSchema,
  transportFailure: unavailable,
});
