import { z } from "zod";

/** Canonical public Topic/Product slug accepted by the generated backend contract. */
export const collectionSlugSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u)
  .max(120);
