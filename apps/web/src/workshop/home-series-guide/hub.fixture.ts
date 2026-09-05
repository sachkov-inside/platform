import type { HomeView } from "@/_pages/home";
import type { ContentCover, MaterialPreview } from "@/entities/material";
import { illustratedHome } from "@/_pages/home/ui/illustrated-home.fixture";
import { membershipsFor, proofSeries } from "./series-order.fixture";
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
        seriesMemberships: membershipsFor(`episode-${String(index + 1)}`),
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
      seriesMemberships: membershipsFor(`guide-${key}`),
    }),
  );
  // Existing main's illustrative note cards preserve the feed's density, not new authored content.
  const notes = illustratedHome.notes.map((note, index) => ({
    ...note,
    topic: index === 0 ? "Поставка" : "Архитектура",
    topicSlug: index === 0 ? "delivery" : "architecture",
    seriesMemberships: membershipsFor(note.slug),
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
        id: "harness",
        slug: "harness",
        name: "Как организовать harness для проекта",
        count: proofSeries.guides.materialSlugs.length,
        summary:
          "Для первой задачи с агентом. Настройте правила проекта и проверьте изменение. 2 образца гайдов. Видео и заметка доступны по связанным ссылкам.",
        cover: cover(1),
        previewItems: guideItems,
      },
      {
        id: "development",
        slug: "development",
        name: "Разработка платформы",
        count: proofSeries.videos.materialSlugs.length,
        summary:
          "8 видео из Telegram · от идеи Inside до дизайна, архитектуры и работы над задачами.",
        cover: cover(5),
        previewItems: videos.slice(0, 3),
      },
      {
        id: "review",
        slug: "review",
        name: "Проверка работы агента",
        count: proofSeries.review.materialSlugs.length,
        summary:
          "Смешанная тестовая серия. Явный порядок: гайд → видео → заметка. 3 образца.",
        cover: cover(8),
        previewItems: [
          ...guideItems.slice(0, 1),
          ...videos.filter((item) => item.slug === "episode-5"),
          ...notes.slice(0, 1),
        ],
      },
    ],
  };
}
