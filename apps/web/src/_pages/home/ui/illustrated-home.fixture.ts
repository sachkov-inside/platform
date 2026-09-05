import type { ContentCover, MaterialPreview } from "@/entities/material";
import type { HomeView } from "../model/home-view";

// Stable presentation data for the generated cover study; live content uses authoring uploads.
function cover(index: number, wide = false): ContentCover {
  return {
    coverId: `27100000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    renditions: [{ width: 960, height: wide ? 540 : 960 }],
  };
}

const topics = [
  { name: "Архитектура", slug: "platform", artwork: 1 },
  { name: "Backend", slug: "backend", artwork: 2 },
  { name: "Frontend", slug: "frontend", artwork: 3 },
  { name: "Поставка", slug: "delivery", artwork: 4 },
] as const;

function material(
  slug: string,
  title: string,
  topicIndex: number,
  artwork: number,
  duration?: number,
): MaterialPreview {
  const topic = topics[topicIndex] ?? topics[0];
  return {
    access: "free",
    availability: "available",
    cover: cover(artwork, duration !== undefined),
    format: duration === undefined ? "Гайд" : "Видео",
    formatSlug: duration === undefined ? "guide" : "video",
    ...(duration === undefined ? {} : { primaryVideoDurationSeconds: duration }),
    seriesMemberships: [],
    slug,
    summary: "Практический разбор: от понятных границ к работающему приложению.",
    tags: [],
    title,
    topic: topic.name,
    topicSlug: topic.slug,
  };
}

const videos = [
  material("produkt-i-inzhenernyy-kontekst", "Продукт и инженерный контекст", 0, 5, 754),
  material("glubokie-moduli-na-praktike", "Глубокие модули на практике", 1, 6, 481),
  material("video-pro-developer-pipeline", "От задачи до релиза: Developer Pipeline", 3, 7, 628),
] as const satisfies readonly MaterialPreview[];
const guides = [
  { ...material("developer-pipeline-bez-poteri-konteksta", "Developer Pipeline без потери контекста", 3, 11), access: "membership", availability: "locked" },
  material("kak-ustroen-inside-platform", "Как устроен Inside Platform", 0, 1),
  material("arkhitekturnaya-zametka-11", "Границы модулей: где провести линию", 0, 8),
  material("arkhitekturnaya-zametka-10", "API, которым удобно пользоваться", 1, 9),
  material("arkhitekturnaya-zametka-09", "Состояние интерфейса без хаоса", 2, 10),
  material("arkhitekturnaya-zametka-08", "Первый релиз без ручной магии", 3, 11),
  material("arkhitekturnaya-zametka-07", "Контракты между сервисами", 1, 9),
  material("arkhitekturnaya-zametka-06", "Компоненты с понятными границами", 2, 10),
] as const satisfies readonly MaterialPreview[];

export const illustratedHome: HomeView = {
  membership: {
    acquisitionUrl: "https://t.me/tribute/app?startapp=inside",
    kind: "inactive",
  },
  guides,
  videos,
  topics: topics.map((topic, index) => ({
    count: [5, 4, 4, 5][index] ?? 0,
    cover: cover(topic.artwork),
    id: `27100000-0000-4000-9000-${String(index + 1).padStart(12, "0")}`,
    name: topic.name,
    previewItems: [],
    slug: topic.slug,
    summary: "Материалы и практические разборы по теме.",
  })),
  playlists: [
    {
      count: 6,
      cover: cover(7, true),
      id: "27100000-0000-4000-9000-000000000005",
      name: "От кода до релиза",
      previewItems: [guides[0], guides[5], videos[2]],
      slug: "ot-koda-do-reliza",
      summary: "Изменение, проверка, выпуск: собираем надёжный путь поставки.",
    },
    {
      count: 2,
      cover: cover(1),
      id: "27100000-0000-4000-9000-000000000006",
      name: "Создание Platform Inside",
      previewItems: [guides[1], guides[0]],
      slug: "platform-inside",
      summary: "Путь от продуктовой идеи до работающей Platform.",
    },
  ],
  notes: [
    {
      ...material("proveryaemaya-postavka", "Маленький релиз проще проверить", 3, 11),
      cover: null,
      format: "Заметка",
      formatSlug: "note",
      summary: "Как сделать изменения небольшими, проверки понятными, а выпуск — предсказуемым.",
    },
    {
      ...material("granitsy-khoroshego-modulya", "Хороший модуль скрывает сложность", 0, 8),
      cover: null,
      format: "Заметка",
      formatSlug: "note",
      summary: "Как разделить ответственность и сохранить простоту системы по мере её роста.",
    },
  ],
};
