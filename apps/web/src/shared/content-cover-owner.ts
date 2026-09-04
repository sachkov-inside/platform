import { z } from "zod";

export const contentCoverOwnerKindSchema = z.enum([
  "material",
  "series",
  "topic",
]);

export type ContentCoverOwnerKind = z.infer<
  typeof contentCoverOwnerKindSchema
>;
