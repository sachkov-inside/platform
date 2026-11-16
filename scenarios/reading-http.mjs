import { readingMaterials, readingProduct, readingTopic } from "./reading.mjs";

export function readingHttpMaterials() {
  return readingMaterials.map((material, index) => ({
    ...material,
    availability: material.access === "free" ? "available" : "locked",
    contentVersion: 1,
    cover: null,
    difficulty: "basic",
    format: {
      id: material.format,
      slug: material.format,
      name: material.format === "video" ? "Видео" : "Гайд",
    },
    outcomes: ["Понимать, как устроен переход между страницами"],
    primaryVideoId: null,
    productMemberships: [
      { ordinal: index + 1, product: { ...readingProduct }, stepGroup: null },
    ],
    tags: [],
    topic: { ...readingTopic },
  }));
}
