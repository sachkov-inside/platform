/**
 * Иллюстрации плиток глав на вкладке «Программа» (решение владельца 23.11.2026, прототип
 * `prototype/course-chapter-tiles`). Картинку глава получает по названию, а не по месту в программе:
 * автор переставляет главы в Course Studio, и рисунок остаётся у своей главы. Глава без записи
 * получает нейтральный рисунок уроков, так что любая программа выглядит цельной.
 */
export type ChapterArt =
  | "agents"
  | "design"
  | "factory"
  | "harness"
  | "intro"
  | "lessons"
  | "mechanics"
  | "practice"
  | "production";

export type ChapterTone =
  "blue" | "coral" | "good" | "ink" | "lavender" | "sand" | "stone";

export interface ChapterTileArt {
  readonly art: ChapterArt;
  readonly tone: ChapterTone;
}

const known: Readonly<Record<string, ChapterTileArt>> = {
  // Программа AI Engineering на 23.11.2026.
  "Как устроен курс": { art: "intro", tone: "sand" },
  "Свой harness и первый цикл работы с агентом": {
    art: "harness",
    tone: "ink",
  },
  "Практика на проекте \u2014 агент-помощник для подготовки к собеседованиям": {
    art: "practice",
    tone: "coral",
  },
  "Проектирование до кода: предметная область, DDD и границы модулей": {
    art: "design",
    tone: "lavender",
  },
  "Механики harness: тесты, проверки, ревью и доставка": {
    art: "mechanics",
    tone: "good",
  },
  "Разработка агентов и встраивание их в продукты": {
    art: "agents",
    tone: "blue",
  },
  "Агенты в продакшене: инфраструктура и автоматизация": {
    art: "production",
    tone: "stone",
  },
  "Software factory и оркестрация": { art: "factory", tone: "stone" },
};

const neutralTones: readonly ChapterTone[] = [
  "sand",
  "lavender",
  "good",
  "blue",
  "coral",
];

/**
 * Рисунок главы. Тон неизвестной главы чередуется по её номеру, чтобы соседние плитки не сливались;
 * сам рисунок от названия не зависит.
 */
export function chapterTileArt(name: string, index: number): ChapterTileArt {
  return (
    known[name.trim()] ?? {
      art: "lessons",
      tone: neutralTones[index % neutralTones.length] ?? "sand",
    }
  );
}
