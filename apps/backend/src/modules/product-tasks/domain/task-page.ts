import { z } from "zod";
import {
  materialBodyOperations,
  type MaterialBodySnapshot,
} from "../../materials/index.js";

// The wire schema is opaque like Materials' document boundary. Parse JSON at runtime without
// publishing Zod's primitive recursive aliases to generated OpenAPI clients.
const jsonValueSchema = z.unknown().transform((value, context) => {
  const parsed = z.json().safeParse(value);
  if (parsed.success) return parsed.data;
  context.addIssue({ code: "custom", message: "Expected a JSON value" });
  return z.NEVER;
});

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
  .catchall(jsonValueSchema);
export const taskPageBodySchema = z
  .object({
    schemaVersion: z.literal(1),
    doc: z.record(z.string(), jsonValueSchema),
  })
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
