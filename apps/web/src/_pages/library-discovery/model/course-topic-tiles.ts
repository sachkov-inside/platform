/**
 * Плитки блока «Что изучим» на странице курса AI Engineering. Иллюстрацию, ширину и цвет плитка
 * получает по названию темы, а не по её месту в описании: автор переставляет темы в Course Studio,
 * и картинка остаётся у своей темы. Тема без записи рисуется без иллюстрации.
 */
export type CourseTopicArt =
  | "agent"
  | "budget"
  | "checks"
  | "context"
  | "domain"
  | "engineering"
  | "evals"
  | "factory"
  | "flow"
  | "guard"
  | "harness"
  | "human"
  | "legacy"
  | "memory"
  | "modules"
  | "pipeline"
  | "production"
  | "proof"
  | "rag"
  | "release"
  | "sdd"
  | "security"
  | "story"
  | "team"
  | "toolkit";

export type CourseTopicTone =
  "blue" | "coral" | "example" | "good" | "ink" | "lavender" | "sand";

export interface CourseTopicTile {
  readonly art: CourseTopicArt;
  /** Широкая плитка занимает две колонки сетки из четырёх, узкая одну. */
  readonly size: "wide" | "narrow";
  readonly tone: CourseTopicTone;
}

const tile = (
  art: CourseTopicArt,
  size: CourseTopicTile["size"],
  tone: CourseTopicTone,
): CourseTopicTile => ({ art, size, tone });

const tiles: Readonly<Record<string, CourseTopicTile>> = {
  // Темы лендинга по программе с 23.11.2026: путь курса от harness до software factory,
  // ряды по четыре колонки (широкая плитка занимает две). У каждой темы свой рисунок по форме:
  // слои, шкала, переписка, документ, схема, терминал, запись, аватары, орбита, лог, доска
  // (23.11.2026).
  "Свой harness": tile("harness", "wide", "ink"),
  "Пайплайн разработки": tile("flow", "narrow", "example"),
  "Проектирование с агентом": tile("story", "narrow", "sand"),
  "Domain-Driven Design": tile("domain", "narrow", "lavender"),
  "Модули и архитектура": tile("modules", "narrow", "good"),
  "Proof of work": tile("proof", "wide", "lavender"),
  "Ревью и Human in the loop": tile("human", "narrow", "sand"),
  "Улучшение harness": tile("evals", "wide", "coral"),
  "Разработка собственных агентов": tile("agent", "wide", "ink"),
  "Агенты в продакшене": tile("production", "wide", "example"),
  "Software factory": tile("factory", "wide", "good"),
  // Темы лендинга с 31.10.2026: инженерные и AI-темы чередуются, ряды по четыре колонки.
  "Инженерная работа": tile("engineering", "wide", "ink"),
  "Harness и пайплайн разработки": tile("flow", "narrow", "example"),
  "Продукт и требования": tile("story", "narrow", "sand"),
  "Spec-Driven Development": tile("sdd", "wide", "blue"),
  "Домен и бизнес-логика": tile("domain", "narrow", "lavender"),
  "Human in the loop": tile("human", "narrow", "sand"),
  Модульность: tile("modules", "narrow", "good"),
  "Контекст и память": tile("memory", "wide", "coral"),
  "Автоматические проверки": tile("checks", "narrow", "blue"),
  "Параллельные агенты": tile("team", "wide", "lavender"),
  "Существующий проект": tile("legacy", "narrow", "sand"),
  "Безопасность агентов": tile("security", "narrow", "good"),
  "Релизы и эксплуатация": tile("release", "wide", "example"),
  "Собственные агенты и MCP": tile("agent", "wide", "ink"),
  // Темы описания, опубликованного до нового лендинга: страница не теряет картинки, пока текст
  // в Course Studio не обновлён. Прежнее название плитки с облачными агентами (до 02.11.2026).
  "Параллельные и облачные агенты": tile("team", "wide", "lavender"),
  "AI-first разработка": tile("engineering", "wide", "ink"),
  Harness: tile("harness", "narrow", "example"),
  "Работа с контекстом": tile("context", "narrow", "blue"),
  "Пайплайны разработки": tile("pipeline", "narrow", "good"),
  "Собственные агенты": tile("agent", "wide", "coral"),
  RAG: tile("rag", "narrow", "lavender"),
  "Контроль агентов": tile("guard", "wide", "sand"),
  "Evals и эксплуатация": tile("evals", "wide", "lavender"),
  "MCP и инструменты агентов": tile("toolkit", "wide", "good"),
  "Экономия токенов": tile("budget", "wide", "blue"),
};

export function courseTopicTile(title: string): CourseTopicTile | undefined {
  return Object.hasOwn(tiles, title) ? tiles[title] : undefined;
}
