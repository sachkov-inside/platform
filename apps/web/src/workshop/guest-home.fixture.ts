import type { HomeView } from "@/_pages/home";
import type { MaterialPreview } from "@/entities/material";

// Presentation-only fixtures shared by the Home study and production page previews.
export const materials = [
  { slug: "ci-checks", title: "Что проверять в CI до деплоя", summary: "Собираем короткий набор проверок, который ловит ошибки до production.", topic: "Инфраструктура", topicSlug: "delivery", format: "Гайд", formatSlug: "guide", access: "free", availability: "available", cover: null, tags: [], seriesMemberships: [] },
  { slug: "agent-context", title: "Как дать ИИ контекст своего проекта", summary: "Правила, границы задачи и проверка результата на примере рабочего репозитория.", topic: "Разработка с ИИ", topicSlug: "ai", format: "Гайд", formatSlug: "guide", access: "membership", availability: "locked", cover: null, tags: [], seriesMemberships: [] },
  { slug: "module-boundaries", title: "Границы модулей: где провести линию", summary: "Разбираем ответственность, интерфейс и стоимость следующего изменения.", topic: "Архитектура", topicSlug: "architecture", format: "Гайд", formatSlug: "guide", access: "membership", availability: "locked", cover: null, tags: [], seriesMemberships: [] },
  { slug: "safe-deploy", title: "Деплой с возможностью отката", summary: "Версия приложения, проверка готовности и возврат к рабочему состоянию.", topic: "Инфраструктура", topicSlug: "delivery", format: "Гайд", formatSlug: "guide", access: "membership", availability: "locked", cover: null, tags: [], seriesMemberships: [] },
] as const satisfies readonly MaterialPreview[];
export const firstMaterial = materials[0];
export const series = [
  { slug: "code-to-production", name: "От кода до production", summary: "Собери понятный путь от изменения в коде до безопасного деплоя.", countLabel: "3 материала", cover: null, previewItems: [firstMaterial, materials[3], materials[2]] },
  { slug: "inside-with-ai", name: "Создаём Inside с ИИ", summary: "Проследи, как я проектирую и развиваю реальную платформу вместе с агентами.", countLabel: "3 материала", cover: null, previewItems: [materials[1], materials[2], materials[3]] },
] as const;

export const videos = [
  { ...materials[1], slug: "ai-project-walkthrough", title: "От задачи до работающего кода с ИИ", summary: "Разбираем контекст, изменение и проверку результата на реальном проекте.", format: "Видео", formatSlug: "video", primaryVideoDurationSeconds: 754 },
  { ...materials[2], slug: "module-design-review", title: "Как найти границы модуля", summary: "Смотрим на ответственность и зависимости в коде.", format: "Видео", formatSlug: "video", primaryVideoDurationSeconds: 481 },
  { ...materials[3], slug: "deploy-walkthrough", title: "Деплой по шагам: от CI до отката", summary: "Проверяем путь изменения от коммита до работающего приложения.", format: "Видео", formatSlug: "video", primaryVideoDurationSeconds: 628 },
] as const satisfies readonly MaterialPreview[];
export const notes = [
  { ...materials[0], slug: "small-releases", title: "Маленький релиз проще проверить", summary: "Чем меньше изменение, тем проще понять его эффект и найти причину ошибки.", format: "Заметка", formatSlug: "note" },
  { ...materials[2], slug: "clear-interfaces", title: "Хороший интерфейс объясняет границы", summary: "Если для вызова нужно знать внутренности модуля, граница ещё не проведена.", format: "Заметка", formatSlug: "note" },
] as const satisfies readonly MaterialPreview[];
export const allMaterials = [...materials, ...videos, ...notes] as const satisfies readonly MaterialPreview[];
export const guestHome: HomeView = {
  guides: materials,
  videos,
  notes,
  playlists: series.map((item) => ({ ...item, id: item.slug, count: item.previewItems.length })),
  topics: Array.from(new Set(materials.map((item) => item.topicSlug))).map((slug) => {
    const members = allMaterials.filter((item) => item.topicSlug === slug);
    return { id: slug, slug, name: members[0]?.topic ?? slug, count: members.length, cover: null, previewItems: [], summary: null };
  }),
};
