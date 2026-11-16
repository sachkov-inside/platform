export const readingProduct: Readonly<{
  id: string;
  name: string;
  slug: string;
}>;
export const readingTopic: Readonly<{ id: string; name: string; slug: string }>;
export const readingMaterials: readonly Readonly<{
  materialId: string;
  slug: string;
  title: string;
  summary: string;
  access: "free" | "closed";
  format: "video" | "guide";
  publishedAt: string;
}>[];
