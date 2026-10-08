import { z } from "zod";
import {
  materialBodyOperations,
  type MaterialBodySnapshot,
} from "../../materials/index.js";

/** Original source row, including metadata that the reader does not render. */
export const sourceTaskPageSchema = z
  .object({
    title: z.string().min(1).max(200),
    summary: z.string().max(16000),
    markdown: z.string().max(1000000),
    links: z.record(z.string(), z.string()),
    images: z.record(z.string(), z.string()),
    coverAssetId: z.string().nullable().optional(),
    coverAlt: z.string().nullable().optional(),
    artifacts: z
      .array(
        z
          .object({
            sourceId: z.string(),
            title: z.string(),
            assetId: z.string(),
          })
          .strict(),
      )
      .optional(),
  })
  .catchall(z.json());
export const taskPageBodySchema = z
  .object({ schemaVersion: z.literal(1), doc: z.record(z.string(), z.json()) })
  .strict()
  .refine(
    (value) => materialBodyOperations.accept(value).ok,
    "Invalid MaterialBody",
  );
export const taskImageReferenceSchema = z
  .object({ assetId: z.uuid(), materialId: z.uuid() })
  .strict();
export const storedTaskPageSchema = z
  .object({
    source: sourceTaskPageSchema,
    body: taskPageBodySchema,
    resolvedLinks: z.record(z.string(), z.string().min(1).max(200)),
    resolvedImages: z.record(z.string(), taskImageReferenceSchema),
  })
  .strict();
export type StoredTaskPage = z.infer<typeof storedTaskPageSchema>;

export function renderTaskBody(body: MaterialBodySnapshot) {
  const rendered = materialBodyOperations.render(body);
  if (!rendered.ok) throw new Error("Invalid stored Task page");
  return rendered.value;
}
