/**
 * Плитки блока «Что изучим» на странице курса AI Engineering. Иллюстрацию, ширину и цвет плитка
 * получает по названию темы, а не по её месту в описании: автор переставляет темы в Inside Content,
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
  | "flow"
  | "guard"
  | "harness"
  | "human"
  | "legacy"
  | "memory"
  | "modules"
  | "pipeline"
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
  "Параллельные и облачные агенты": tile("team", "wide", "lavender"),
  "Существующий проект": tile("legacy", "narrow", "sand"),
  "Безопасность агентов": tile("security", "narrow", "good"),
  "Релизы и эксплуатация": tile("release", "narrow", "example"),
  "Собственные агенты и MCP": tile("agent", "wide", "ink"),
  "Evals и стоимость": tile("evals", "narrow", "lavender"),
  // Темы описания, опубликованного до нового лендинга: страница не теряет картинки, пока текст
  // в Inside Content не обновлён.
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
