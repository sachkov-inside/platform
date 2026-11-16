import { readingMaterials, readingProduct, readingTopic } from "./reading.mjs";
type Material = (typeof readingMaterials)[number];
export function readingHttpMaterials(): (Omit<Material, "format"> & {
  availability: "available" | "locked" | "unavailable";
  contentVersion: number;
  cover: null;
  difficulty: "basic";
  format: { id: string; slug: string; name: string };
  outcomes: string[];
  primaryVideoId: null;
  productMemberships: {
    ordinal: number;
    product: typeof readingProduct;
    stepGroup: null;
  }[];
  tags: [];
  topic: typeof readingTopic;
})[];
