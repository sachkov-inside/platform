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
