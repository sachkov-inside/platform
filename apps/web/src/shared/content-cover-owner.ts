import { z } from "zod";

export const contentCoverOwnerKindSchema = z.enum([
  "material",
  "product",
  "topic",
]);

export type ContentCoverOwnerKind = z.infer<typeof contentCoverOwnerKindSchema>;
