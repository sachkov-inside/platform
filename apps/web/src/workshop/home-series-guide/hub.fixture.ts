import type { HomeView } from "@/_pages/home";
import type { ContentCover, MaterialPreview } from "@/entities/material";
import { illustratedHome } from "@/_pages/home/ui/illustrated-home.fixture";
import { episodes, guides } from "./content.fixture";

const cover = (index: number): ContentCover => ({
  coverId: `27100000-0000-4000-8000-${String(index).padStart(12, "0")}`,
  renditions: [{ width: 960, height: 960 }],
});
const topicSeeds = [
  ["AI-first", "agents", 1],
  ["Архитектура", "architecture", 2],
  ["Продукт", "product", 3],
  ["Поставка", "delivery", 4],
] as const;
const episodeTopics = [0, 0, 3, 2, 0, 1, 2, 3] as const;

/** Same sample set in the existing main composition and the revised hub. No publication claims. */
export function hubFixture(member: boolean): HomeView {
  const videos: MaterialPreview[] = episodes
    .map<MaterialPreview>(([summary, duration], index) => {
      const topic = topicSeeds[episodeTopics[index] ?? 0];
      const [minutes = 0, seconds = 0] = duration.split(":").map(Number);
      return {
        slug: `episode-${String(index + 1)}`,
        title: summary,
        summary,
        format: "Видео",
        formatSlug: "video",
        access: "membership",
        availability: member ? "available" : "locked",
        cover: cover(5 + (index % 3)),
        primaryVideoDurationSeconds: minutes * 60 + seconds,
        topic: topic[0],
        topicSlug: topic[1],
        tags: ["agents"],
        seriesMemberships: [
          {
            slug: "development",
            name: "Разработка платформы",
            ordinal: index + 1,
          },
        ],
      };
    })
    .reverse();
  const guideItems: MaterialPreview[] = (["a", "b"] as const).map(
    (key, index) => ({
      slug: `guide-${key}`,
      title: guides[key].title,
      summary: guides[key].summary,
      format: "Гайд",
      formatSlug: "guide",
      access: key === "a" ? "free" : "membership",
      availability: key === "a" || member ? "available" : "locked",
      cover: cover(index === 0 ? 1 : 8),
      topic: "AI-first",
      topicSlug: "agents",
      tags: ["agents"],
      seriesMemberships: [
        {
          slug: "harness",
          name: "Как организовать harness для проекта",
          ordinal: index + 1,
        },
      ],
    }),
  );
  // Existing main's illustrative note cards preserve the feed's density, not new authored content.
  const notes = illustratedHome.notes.map((note, index) => ({
    ...note,
    topic: index === 0 ? "Поставка" : "Архитектура",
    topicSlug: index === 0 ? "delivery" : "architecture",
  }));
  const all = [...videos, ...guideItems, ...notes];
  return {
    videos,
    guides: guideItems,
    notes,
    topics: topicSeeds.map(([name, slug, artwork]) => ({
      id: slug,
      name,
      slug,
      count: all.filter((item) => item.topicSlug === slug).length,
      cover: cover(artwork),
      summary: "Материалы и разборы по теме",
      previewItems: [],
    })),
    playlists: [
      {
        id: "development",
        slug: "development",
        name: "Разработка платформы",
        count: 8,
        summary:
          "8 видео из Telegram · от идеи Inside до дизайна, архитектуры и работы над задачами.",
        cover: cover(5),
        previewItems: videos.slice(0, 3),
      },
      {
        id: "harness",
        slug: "harness",
        name: "Как организовать harness для проекта",
        count: 2,
        summary:
          "Серия гайдов · правила проекта, работа с агентом и проверка результата. 2 образца.",
        cover: cover(1),
        previewItems: guideItems,
      },
    ],
  };
}
