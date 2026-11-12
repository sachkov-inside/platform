import { z } from "zod";

/** A topic name follows chapter and Product names; the summary is one short line for the reader. */
export const PRODUCT_TOPIC_NAME_MAX = 120;
export const PRODUCT_TOPIC_SUMMARY_MAX = 300;
export const PRODUCT_TOPICS_MAX = 50;
export const PRODUCT_TOPIC_MATERIALS_MAX = 1000;

/**
 * A Product topic groups catalogue Materials for the reader. The author supplies its identifier so
 * that a rename keeps the topic and its Materials. Material order inside a topic is not stored.
 */
export const productTopicDraftSchema = z
  .object({
    id: z.uuid().transform((id) => id.toLowerCase()),
    name: z.string().trim().min(1).max(PRODUCT_TOPIC_NAME_MAX),
    summary: z.string().trim().max(PRODUCT_TOPIC_SUMMARY_MAX),
    materialIds: z
      .array(z.uuid().transform((id) => id.toLowerCase()))
      .max(PRODUCT_TOPIC_MATERIALS_MAX),
  })
  .strict();
export const productTopicDraftsSchema = z
  .array(productTopicDraftSchema)
  .max(PRODUCT_TOPICS_MAX)
  .refine(
    (topics) => new Set(topics.map(({ id }) => id)).size === topics.length,
    { message: "Topic IDs must be unique" },
  )
  .refine(
    (topics) =>
      topics.reduce((total, topic) => total + topic.materialIds.length, 0) <=
      PRODUCT_TOPIC_MATERIALS_MAX,
    { message: "Topics may assign at most 1000 Materials" },
  );
export type ProductTopicDraft = z.output<typeof productTopicDraftSchema>;

export interface ProductTopicEntry {
  readonly id: string;
  readonly name: string;
  readonly summary: string;
  /** Catalogue Materials of the topic, in catalogue order. */
  readonly materialIds: readonly string[];
}

/** Topic Materials follow the catalogue order, so a stored set always reads back the same way. */
export function inCatalogueOrder(
  materialIds: readonly string[],
  catalogue: readonly string[],
): readonly string[] {
  const position = new Map(catalogue.map((id, index) => [id, index]));
  return materialIds
    .filter((id) => position.has(id))
    .sort(
      (left, right) => (position.get(left) ?? 0) - (position.get(right) ?? 0),
    );
}
