// @ts-check
import {
  readingMaterials,
  openReadingMaterials,
  navigationReadingTopic,
  readingProduct,
  readingTopic,
} from "./reading.mjs";

/** @param {"preview" | "open-course"} [scenario] */
export function readingHttpMaterials(scenario = "preview") {
  const materials =
    scenario === "preview" ? readingMaterials : openReadingMaterials;
  const topic = scenario === "preview" ? readingTopic : navigationReadingTopic;
  return materials.map((material, index) => ({
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
    topic: { ...topic },
  }));
}
