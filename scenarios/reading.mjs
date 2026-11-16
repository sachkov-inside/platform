// @ts-check
// Synthetic domain facts only. Each consumer owns its transport or presentation adapter.
export const readingProduct = Object.freeze({
  id: "11111111-1111-4111-8111-111111111115",
  name: "Курс на 120 материалов",
  slug: "performance-course",
});
export const readingTopic = Object.freeze({
  id: "22222222-2222-4222-8222-222222222223",
  name: "Platform",
  slug: "platform",
});
export const readingMaterials = Object.freeze(
  Array.from({ length: 120 }, (_, index) =>
    Object.freeze({
      materialId: `33333333-3333-4333-8333-${String(index + 201).padStart(12, "0")}`,
      slug: `performance-lesson-${String(index + 1)}`,
      title: `Материал ${String(index + 1)}`,
      summary: `Описание материала ${String(index + 1)}.`,
      access: index < 3 ? "free" : "closed",
      format: index % 2 === 0 ? "video" : "guide",
      publishedAt: new Date(Date.UTC(2026, 5, index + 1)).toISOString(),
    }),
  ),
);

// The navigation performance course and scroll feed were always public; the preview
// deliberately retains locked lessons. These are distinct scenarios, not role authorization.
export const openReadingMaterials = readingMaterials.map((material) => ({
  ...material,
  access: "free",
}));
export const navigationReadingTopic = Object.freeze({
  id: "22222222-2222-4222-8222-222222222222",
  name: "Переходы",
  slug: "navigation-topic",
});
