/** #290: one explicit order per Series, independent of format and publication time. */
export const proofSeries = {
  guides: {
    slug: "harness",
    name: "Как организовать harness для проекта",
    materialSlugs: ["guide-a", "guide-b"],
  },
  review: {
    slug: "review",
    name: "Проверка работы агента",
    materialSlugs: ["guide-a", "episode-5", "proveryaemaya-postavka"],
  },
  videos: {
    slug: "development",
    name: "Разработка платформы",
    materialSlugs: Array.from(
      { length: 8 },
      (_, index) => `episode-${String(index + 1)}`,
    ),
  },
} as const;

export function membershipsFor(slug: string) {
  return Object.values(proofSeries).flatMap((series) => {
    const ordinal =
      (series.materialSlugs as readonly string[]).indexOf(slug) + 1;
    return ordinal ? [{ slug: series.slug, name: series.name, ordinal }] : [];
  });
}
