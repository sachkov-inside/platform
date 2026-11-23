import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  FileText,
  LayoutGrid,
  List,
  Play,
  X,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { CourseMark } from "@/features/ai-engineering-course";
import {
  CourseNavigationBar,
  CourseNavigationItem,
} from "@/features/library-discovery";
import { Breadcrumbs } from "@/shared/ui/breadcrumbs";
import { HidePublicFooter } from "@/shared/ui/hide-public-footer.client";
import { publicPageEnvironment } from "@/storybook/story-environment";
import styles from "./chapter-tiles-prototype.module.css";
// The live programme frame and section column, so the prototype keeps the real course menu.
import "./product-programme-view.css";

// Throwaway (owner request 2026-11-23): chapters of the course programme as illustrated tiles in
// place of expanding rows, and three ways to show a chapter's lessons. Fixture data and in-memory
// state only; nothing in production imports this file. Chapter names, counts and the lessons of
// chapter 3 follow the live AI Engineering programme; other lesson titles are invented.

// ---------- Fixture ----------

type Tone = "sand" | "ink" | "lavender" | "blue" | "good" | "coral" | "stone";
type ArtId =
  | "intro"
  | "harness"
  | "practice"
  | "design"
  | "mechanics"
  | "agents"
  | "production"
  | "factory";

interface Lesson {
  readonly title: string;
  readonly kind: "text" | "video";
  readonly length: string;
  readonly done: boolean;
}

interface Chapter {
  readonly id: string;
  readonly name: string;
  readonly art: ArtId;
  readonly tone: Tone;
  readonly status: "ready" | "writing" | "planned";
  readonly description: string;
  readonly lessons: readonly Lesson[];
}

const text = (title: string, minutes: number, done = false): Lesson => ({
  title,
  kind: "text",
  length: `${String(minutes)} мин`,
  done,
});
const video = (title: string, length: string, done = false): Lesson => ({
  title,
  kind: "video",
  length,
  done,
});

const chapters: readonly Chapter[] = [
  {
    id: "intro",
    name: "Как устроен курс",
    art: "intro",
    tone: "sand",
    status: "ready",
    description:
      "Маршрут курса, как устроены уроки и задания и где просить помощи.",
    lessons: [text("Как устроен курс", 8, true)],
  },
  {
    id: "harness",
    name: "Свой harness и первый цикл работы с агентом",
    art: "harness",
    tone: "ink",
    status: "ready",
    description:
      "Готовим проект к работе с агентом: инструкции, скиллы, проверки и первый полный цикл от задачи до результата.",
    lessons: [
      text("Выбор агента и модели", 14, true),
      text(
        "Как агент работает с проектом: контекст, инструменты и harness",
        18,
        true,
      ),
      text("Подготовка проекта: инструкции, скиллы и репозиторий", 16, true),
      video("Практика: начинаем работу с агентом в проекте", "42:10", true),
      text("Первая версия продукта: сценарии и границы", 12, true),
      video("Практика: проектирование с агентом через grilling", "37:45", true),
      text("Домен и общий язык", 11, true),
      text("Выбор стека и границ модулей", 15),
      video("Практика: от спецификации к работающему приложению", "58:02"),
      text("Настройка тестов, проверок архитектуры и CI", 17),
      text("Проверка настройки на маленькой задаче", 9),
      text("Итоги: готовность проекта к разработке функций", 6),
    ],
  },
  {
    id: "practice",
    name: "Практика на проекте: агент-помощник для подготовки к собеседованиям",
    art: "practice",
    tone: "coral",
    status: "writing",
    description:
      "Строим настоящий продукт с агентом от идеи до первого этапа разработки. Новые уроки выходят по мере записи.",
    lessons: [
      video("Практика на проекте. От идеи к Wayfinder", "1:00:56"),
      video("Практика на проекте. От сценариев к границам модулей", "1:01:28"),
      video(
        "Практика на проекте. От Wayfinder к первому этапу разработки",
        "15:51",
      ),
      video(
        "Практика на проекте. От сценария подготовки к задачам первого этапа",
        "39:06",
      ),
    ],
  },
  {
    id: "design",
    name: "Проектирование до кода: предметная область, DDD и границы модулей",
    art: "design",
    tone: "lavender",
    status: "ready",
    description:
      "Как описать предметную область так, чтобы агент писал код в правильных границах.",
    lessons: [
      text("Зачем проектировать до кода", 9),
      text("Предметная область и общий язык", 14),
      text("Сценарии и события", 12),
      text("Агрегаты и инварианты", 16),
      text("Ограниченные контексты", 13),
      text("Границы модулей", 15),
      video("Практика: карта контекстов с агентом", "44:20"),
      text("ADR: записываем решения", 8),
      text("Итоги: модель, готовая к реализации", 5),
    ],
  },
  {
    id: "mechanics",
    name: "Механики harness: тесты, проверки, ревью и доставка",
    art: "mechanics",
    tone: "good",
    status: "ready",
    description:
      "Обратная связь, которая держит агента в рамках: тесты, проверки архитектуры, ревью и путь до merge.",
    lessons: [
      text("Тесты, которые пишет агент", 13),
      video("TDD с агентом", "33:15"),
      text("Проверки архитектуры", 11),
      text("Линтеры и типы как обратная связь", 9),
      text("Ревью: агент проверяет агента", 14),
      text("Human in the loop", 10),
      text("Доставка: PR, CI и очередь слияния", 12),
      text("Proof of work", 9),
    ],
  },
  {
    id: "agents",
    name: "Разработка агентов и встраивание их в продукты",
    art: "agents",
    tone: "blue",
    status: "writing",
    description:
      "Пишем собственного агента: цикл, инструменты, память, MCP и проверка качества.",
    lessons: [
      text("Что такое агент изнутри", 12),
      text("Цикл агента и tool calling", 16),
      text("Инструменты и их описания", 11),
      text("Память и состояние", 14),
      text("Контекст: что положить в окно", 12),
      video("MCP-сервер своими руками", "48:30"),
      text("RAG: поиск по документам", 17),
      text("Структурированный вывод", 9),
      text("Агент внутри продукта", 13),
      text("Ограничения и права", 10),
      text("Evals: как проверить агента", 15),
      text("Трассировка и стоимость", 11),
      video("Практика: агент для подготовки к собеседованиям", "52:44"),
    ],
  },
  {
    id: "production",
    name: "Агенты в продакшене: инфраструктура и автоматизация",
    art: "production",
    tone: "stone",
    status: "planned",
    description:
      "Выкатываем реальный проект в продакшен и подключаем агентов к его работе: деплой, мониторинг, инциденты и задачи из фидбэка.",
    lessons: [],
  },
  {
    id: "factory",
    name: "Software factory и оркестрация",
    art: "factory",
    tone: "stone",
    status: "planned",
    description:
      "Собираем всё из курса в один рабочий процесс на реальном проекте: агенты берут задачи, пишут код, проверяют друг друга и доводят работу до мержа.",
    lessons: [],
  },
];

const allLessons = chapters.flatMap((chapter) => chapter.lessons);
const studied = allLessons.filter((lesson) => lesson.done).length;

/** Number of the chapter's first lesson in the whole course. */
function firstNumber(chapter: Chapter): number {
  let number = 1;
  for (const item of chapters) {
    if (item.id === chapter.id) return number;
    number += item.lessons.length;
  }
  return number;
}

function chapterStudied(chapter: Chapter): number {
  return chapter.lessons.filter((lesson) => lesson.done).length;
}

function nextLesson(chapter: Chapter): number | null {
  const index = chapter.lessons.findIndex((lesson) => !lesson.done);
  return index === -1 ? null : index;
}

/** The chapter a reader is in: the first one with a lesson left. */
const currentChapter: Chapter =
  chapters.find(
    (chapter) => chapter.lessons.length > 0 && nextLesson(chapter) !== null,
  ) ?? fallbackChapter();

function fallbackChapter(): Chapter {
  const chapter = chapters[0];
  if (chapter === undefined) throw new Error("Prototype needs chapters");
  return chapter;
}

function lessonWord(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return "урок";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "урока";
  return "уроков";
}

// ---------- Illustrations ----------

const line = {
  fill: "none",
  stroke: "var(--art-ink)",
  strokeWidth: 2.5,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};
const paper = { ...line, fill: "var(--art-paper)" };
const accent = { ...line, fill: "var(--accent)" };
const soft = { ...line, stroke: "var(--art-soft)" };

const artwork: Readonly<Record<ArtId, ReactNode>> = {
  intro: (
    <>
      <path
        {...line}
        d="M44 140 C 92 142, 96 96, 140 98 S 196 124, 214 86 S 246 52, 268 50"
        strokeDasharray="2 9"
      />
      <circle {...accent} cx="44" cy="140" r="9" />
      <circle {...paper} cx="140" cy="98" r="10" />
      <path {...line} d="M135 98 l4 4 l7 -8" />
      <circle {...paper} cx="214" cy="86" r="10" />
      <path {...line} d="M268 50 V 18" />
      <path {...accent} d="M268 18 L 296 26 L 268 34 Z" />
      <rect {...paper} x="36" y="28" width="72" height="52" rx="8" />
      <path {...soft} d="M48 44 H 94 M48 56 H 86 M48 68 H 78" />
    </>
  ),
  harness: (
    <>
      <rect {...paper} x="34" y="30" width="156" height="114" rx="12" />
      <path {...line} d="M34 52 H 190" />
      <circle cx="48" cy="41" r="3" fill="var(--art-ink)" />
      <circle cx="59" cy="41" r="3" fill="var(--art-ink)" />
      <circle cx="70" cy="41" r="3" fill="var(--art-ink)" />
      <path {...line} d="M50 70 l9 7 l-9 7" />
      <path {...line} stroke="var(--accent)" d="M68 84 H 116" />
      <path {...soft} d="M50 102 H 168 M50 116 H 140 M50 130 H 154" />
      <path
        {...line}
        d="M190 88 C 204 88, 206 88, 220 88"
        strokeDasharray="1 7"
      />
      <rect {...paper} x="220" y="64" width="62" height="50" rx="14" />
      <circle cx="240" cy="88" r="4.5" fill="var(--art-ink)" />
      <circle cx="262" cy="88" r="4.5" fill="var(--art-ink)" />
      <path {...line} d="M251 64 V 48" />
      <circle {...accent} cx="251" cy="42" r="6" />
      <path {...line} d="M236 114 V 130 M266 114 V 130" />
      <rect {...paper} x="224" y="130" width="24" height="18" rx="5" />
      <rect {...accent} x="254" y="130" width="24" height="18" rx="5" />
    </>
  ),
  practice: (
    <>
      <circle {...paper} cx="52" cy="58" r="18" />
      <path {...line} d="M44 54 h0.1 M60 54 h0.1" strokeWidth="5" />
      <path {...line} d="M45 65 q7 6 14 0" />
      <path
        {...paper}
        d="M84 34 H 196 a12 12 0 0 1 12 12 V 70 a12 12 0 0 1 -12 12 H 96 L 80 92 L 84 80 a12 12 0 0 1 -12 -12 V 46 a12 12 0 0 1 12 -12 Z"
      />
      <path {...soft} d="M90 52 H 186 M90 66 H 160" />
      <rect {...paper} x="250" y="104" width="40" height="38" rx="11" />
      <circle cx="263" cy="121" r="3.5" fill="var(--art-ink)" />
      <circle cx="277" cy="121" r="3.5" fill="var(--art-ink)" />
      <path
        {...accent}
        d="M120 100 H 228 a12 12 0 0 1 12 12 V 134 a12 12 0 0 1 -12 12 H 228 L 244 158 L 222 146 H 120 a12 12 0 0 1 -12 -12 V 112 a12 12 0 0 1 12 -12 Z"
      />
      <path
        {...line}
        stroke="var(--accent-foreground)"
        d="M124 116 l6 6 l10 -11 M150 118 H 216 M124 134 H 200"
      />
    </>
  ),
  design: (
    <>
      <rect
        {...line}
        x="26"
        y="26"
        width="134"
        height="88"
        rx="16"
        strokeDasharray="7 7"
      />
      <rect
        {...line}
        x="176"
        y="38"
        width="118"
        height="78"
        rx="16"
        strokeDasharray="7 7"
      />
      <rect
        {...line}
        x="92"
        y="128"
        width="140"
        height="42"
        rx="14"
        strokeDasharray="7 7"
      />
      <rect {...paper} x="42" y="44" width="44" height="24" rx="6" />
      <rect {...accent} x="98" y="78" width="46" height="24" rx="6" />
      <path {...line} d="M74 68 L 104 78" />
      <rect {...paper} x="192" y="56" width="40" height="24" rx="6" />
      <rect {...paper} x="242" y="84" width="40" height="22" rx="6" />
      <path {...line} d="M222 80 L 252 84" />
      <path {...line} d="M160 72 H 176 M140 114 L 150 128" />
      <rect {...paper} x="108" y="138" width="44" height="22" rx="6" />
      <rect {...paper} x="172" y="138" width="44" height="22" rx="6" />
    </>
  ),
  mechanics: (
    <>
      <path {...line} d="M30 86 H 246" />
      {[62, 124, 186].map((cx) => (
        <g key={cx}>
          <circle {...paper} cx={cx} cy="86" r="18" />
          <path {...line} d={`M${String(cx - 7)} 86 l5 5 l10 -11`} />
        </g>
      ))}
      <rect {...accent} x="244" y="64" width="46" height="44" rx="8" />
      <path
        {...line}
        stroke="var(--accent-foreground)"
        d="M244 80 H 290 M267 64 V 80"
      />
      <circle {...line} cx="186" cy="138" r="13" />
      <path {...line} d="M195 147 L 206 158" />
      <path
        {...soft}
        d="M44 128 H 82 M44 140 H 74 M106 128 H 142 M106 140 H 130"
      />
      <path {...soft} d="M44 34 H 94 M124 34 H 160" />
    </>
  ),
  agents: (
    <>
      <path
        {...line}
        d="M128 96 L 74 122 M192 86 L 250 116 M192 60 L 238 46"
        strokeDasharray="1 7"
      />
      <rect {...paper} x="128" y="42" width="64" height="56" rx="16" />
      <circle cx="148" cy="70" r="5" fill="var(--art-ink)" />
      <circle cx="172" cy="70" r="5" fill="var(--art-ink)" />
      <path {...line} d="M160 42 V 26" />
      <circle {...accent} cx="160" cy="20" r="6" />
      <path {...line} d="M150 98 V 114 M170 98 V 114 M140 114 H 180" />
      <ellipse {...paper} cx="58" cy="120" rx="22" ry="8" />
      <path {...paper} d="M36 120 V 150 a22 8 0 0 0 44 0 V 120" />
      <path {...line} d="M36 134 a22 8 0 0 0 44 0" />
      <circle {...paper} cx="264" cy="128" r="20" />
      <path
        {...line}
        d="M244 128 H 284 M264 108 C 252 120, 252 136, 264 148 M264 108 C 276 120, 276 136, 264 148"
      />
      <rect {...accent} x="232" y="22" width="40" height="48" rx="6" />
      <path
        {...line}
        stroke="var(--accent-foreground)"
        d="M242 36 H 262 M242 46 H 262 M242 56 H 254"
      />
    </>
  ),
  production: (
    <>
      <rect {...paper} x="38" y="36" width="88" height="114" rx="10" />
      <path {...line} d="M38 74 H 126 M38 112 H 126" />
      {[55, 93, 131].map((cy) => (
        <g key={cy}>
          <circle cx="56" cy={cy} r="4" fill="var(--accent)" />
          <path {...soft} d={`M70 ${String(cy)} H 110`} />
        </g>
      ))}
      <rect {...paper} x="156" y="32" width="130" height="82" rx="12" />
      <path
        {...line}
        stroke="var(--accent)"
        d="M170 96 L 196 78 L 216 88 L 240 58 L 270 66"
      />
      <path {...soft} d="M170 104 H 272" />
      <rect {...paper} x="156" y="128" width="130" height="26" rx="13" />
      <circle cx="172" cy="141" r="5" fill="var(--accent)" />
      <path {...soft} d="M186 141 H 266" />
    </>
  ),
  factory: (
    <>
      <rect {...paper} x="26" y="128" width="268" height="22" rx="11" />
      {[46, 160, 274].map((cx) => (
        <circle key={cx} {...line} cx={cx} cy="139" r="5" />
      ))}
      <rect {...paper} x="52" y="98" width="32" height="30" rx="5" />
      <rect {...accent} x="124" y="98" width="32" height="30" rx="5" />
      <rect {...paper} x="230" y="98" width="32" height="30" rx="5" />
      <path
        {...line}
        d="M140 98 V 126 M124 112 H 156"
        stroke="var(--accent-foreground)"
      />
      <path {...line} d="M196 16 V 38 L 176 58 L 180 78" />
      <circle {...paper} cx="196" cy="38" r="6" />
      <circle {...paper} cx="176" cy="58" r="6" />
      <path {...line} d="M170 78 H 190 M172 78 V 88 M188 78 V 88" />
      <circle {...line} cx="262" cy="48" r="18" strokeDasharray="6 5" />
      <circle {...accent} cx="262" cy="48" r="7" />
      <path {...soft} d="M36 40 H 120 M36 54 H 96" />
    </>
  ),
};

function ChapterArt({
  chapter,
  className,
  badge,
}: {
  readonly chapter: Chapter;
  readonly className?: string | undefined;
  readonly badge?: ReactNode;
}) {
  return (
    <div
      className={`${styles["art"] ?? ""} ${className ?? ""}`}
      data-tone={chapter.tone}
      data-planned={chapter.status === "planned" ? "" : undefined}
    >
      <svg aria-hidden="true" viewBox="0 0 320 180">
        {artwork[chapter.art]}
      </svg>
      {badge === undefined ? null : (
        <span className={styles["artBadge"]}>{badge}</span>
      )}
    </div>
  );
}

// ---------- Shared pieces ----------

function StatusBadge({ chapter }: { readonly chapter: Chapter }) {
  if (chapter.status === "writing")
    return (
      <span className={styles["badge"]} data-kind="writing">
        Пишется
      </span>
    );
  if (chapter.status === "planned")
    return (
      <span className={styles["badge"]} data-kind="planned">
        В планах
      </span>
    );
  return null;
}

function ChapterProgress({ chapter }: { readonly chapter: Chapter }) {
  const total = chapter.lessons.length;
  if (chapter.status === "planned") return <span>Скоро</span>;
  const done = chapterStudied(chapter);
  if (done === total)
    return (
      <span className={styles["badge"]} data-kind="done">
        <Check aria-hidden="true" size={12} /> Изучено
      </span>
    );
  return (
    <>
      <span>
        {done === 0
          ? `${String(total)} ${lessonWord(total)}`
          : `${String(done)} из ${String(total)}`}
      </span>
      {done === 0 ? null : (
        <span className={styles["miniBar"]}>
          <span style={{ width: `${String((done / total) * 100)}%` }} />
        </span>
      )}
    </>
  );
}

function Tile({
  chapter,
  selected = false,
  onOpen,
}: {
  readonly chapter: Chapter;
  readonly selected?: boolean;
  readonly onOpen: (element: HTMLButtonElement) => void;
}) {
  const index = chapters.indexOf(chapter) + 1;
  const current = chapter.id === currentChapter.id;
  const badge =
    chapter.status !== "ready" ? (
      <StatusBadge chapter={chapter} />
    ) : current ? (
      <span className={styles["badge"]} data-kind="current">
        Сейчас
      </span>
    ) : undefined;
  return (
    <button
      type="button"
      className={styles["tile"]}
      data-selected={selected ? "" : undefined}
      onClick={(event) => {
        onOpen(event.currentTarget);
      }}
    >
      <ChapterArt chapter={chapter} badge={badge} />
      <span className={styles["tileBody"]}>
        <span className={styles["eyebrow"]}>Глава {index}</span>
        <span className={styles["tileTitle"]}>{chapter.name}</span>
        <span className={styles["tileFoot"]}>
          <ChapterProgress chapter={chapter} />
        </span>
      </span>
    </button>
  );
}

function LessonList({
  chapter,
  onLesson,
  compact = false,
}: {
  readonly chapter: Chapter;
  readonly onLesson: (title: string) => void;
  readonly compact?: boolean;
}) {
  const start = firstNumber(chapter);
  const next = nextLesson(chapter);
  if (chapter.lessons.length === 0)
    return (
      <p className={styles["description"]}>
        Уроков пока нет: глава появится, когда выйдут предыдущие.
      </p>
    );
  return (
    <ol
      className={`${styles["lessons"] ?? ""} ${compact ? (styles["compactLessons"] ?? "") : ""}`}
    >
      {chapter.lessons.map((lesson, index) => {
        const isNext = index === next && chapter.id === currentChapter.id;
        return (
          <li key={lesson.title}>
            <button
              type="button"
              className={styles["lesson"]}
              data-done={lesson.done ? "" : undefined}
              data-current={isNext ? "" : undefined}
              onClick={() => {
                onLesson(lesson.title);
              }}
            >
              <span className={styles["lessonNumber"]}>
                {lesson.done ? (
                  <Check aria-label="Изучено" size={18} />
                ) : (
                  start + index
                )}
              </span>
              <span>
                <span className={styles["lessonTitle"]}>{lesson.title}</span>
                <span className={styles["lessonMeta"]}>
                  {lesson.kind === "video" ? (
                    <Play aria-hidden="true" size={11} fill="currentColor" />
                  ) : (
                    <FileText aria-hidden="true" size={12} />
                  )}
                  {lesson.kind === "video" ? "Видео" : "Текст"} ·{" "}
                  {lesson.length}
                </span>
              </span>
              <span className={styles["lessonState"]}>
                {isNext ? "Следующий" : ""}
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

function ChapterAction({
  chapter,
  onLesson,
}: {
  readonly chapter: Chapter;
  readonly onLesson: (title: string) => void;
}) {
  if (chapter.lessons.length === 0) return null;
  const next = nextLesson(chapter);
  const done = chapterStudied(chapter);
  const target = chapter.lessons[next ?? 0];
  if (target === undefined) return null;
  const label =
    next === null
      ? "Повторить главу"
      : done === 0
        ? "Начать главу"
        : "Продолжить";
  return (
    <button
      type="button"
      className={styles["primary"]}
      onClick={() => {
        onLesson(target.title);
      }}
    >
      <span>
        {label}
        {next === null || done === 0 ? "" : `: ${target.title}`}
      </span>
      <ArrowRight aria-hidden="true" size={16} />
    </button>
  );
}

function ChapterSummary({ chapter }: { readonly chapter: Chapter }) {
  const total = chapter.lessons.length;
  const done = chapterStudied(chapter);
  return (
    <div>
      <div
        className={styles["progressRow"]}
        style={{ marginTop: 0, borderTop: 0, paddingTop: 0 }}
      >
        <span>
          {chapter.status === "planned"
            ? "Глава в планах"
            : `Изучено ${String(done)} из ${String(total)}`}
        </span>
        {chapter.status === "planned" ? null : (
          <span>{String(Math.round((done / Math.max(total, 1)) * 100))}%</span>
        )}
      </div>
      {chapter.status === "planned" ? null : (
        <div className={styles["bar"]}>
          <span
            style={{ width: `${String((done / Math.max(total, 1)) * 100)}%` }}
          />
        </div>
      )}
    </div>
  );
}

function useToast() {
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    if (message === null) return;
    const timer = window.setTimeout(() => {
      setMessage(null);
    }, 2400);
    return () => {
      window.clearTimeout(timer);
    };
  }, [message]);
  const toast =
    message === null ? null : (
      <div role="status" className={styles["toast"]}>
        {message}
      </div>
    );
  return {
    toast,
    openLesson: (title: string) => {
      setMessage(`Прототип: здесь откроется урок «${title}»`);
    },
  };
}

/**
 * The course sections as on the live programme: a sticky column on a computer (icons only on a
 * tablet) and the bottom bar on a phone. Same markup and stylesheet as `ProgrammeSidebar`.
 */
function ProgrammeSections({
  onOpen,
}: {
  readonly onOpen: (label: string) => void;
}) {
  const parts = [
    {
      id: "programme",
      label: "Программа",
      icon: List,
      count: allLessons.length,
    },
    { id: "materials", label: "Материалы", icon: LayoutGrid, count: 48 },
  ] as const;
  return (
    <>
      <aside className="programme-sidebar" data-programme-sidebar>
        <nav aria-label="Разделы продукта" className="programme-sidebar-inner">
          <ul className="programme-sidebar-parts">
            {parts.map((part) => {
              const Icon = part.icon;
              const current = part.id === "programme";
              return (
                <li key={part.id}>
                  <button
                    aria-current={current ? "true" : undefined}
                    data-current={current}
                    onClick={() => {
                      if (!current) onOpen(part.label);
                    }}
                    type="button"
                  >
                    <Icon aria-hidden="true" />
                    <span>{part.label}</span>
                    <small>{part.count}</small>
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>
      </aside>
      <HidePublicFooter />
      <CourseNavigationBar label="Разделы продукта" reserveSpace>
        {parts.map((part) => (
          <CourseNavigationItem
            current={part.id === "programme"}
            icon={part.icon}
            key={part.id}
            label={part.label}
            onClick={() => {
              if (part.id !== "programme") onOpen(part.label);
            }}
          />
        ))}
      </CourseNavigationBar>
    </>
  );
}

function ProgrammeShell({
  children,
  wide = false,
}: {
  readonly children: ReactNode;
  readonly wide?: boolean;
}) {
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    if (notice === null) return;
    const timer = window.setTimeout(() => {
      setNotice(null);
    }, 2400);
    return () => {
      window.clearTimeout(timer);
    };
  }, [notice]);
  return (
    <div
      className="programme-frame @container/programme mx-auto min-w-0 w-full max-w-[46rem]"
      data-prototype-chapter-tiles
    >
      <div
        className={`${styles["page"] ?? ""} ${wide ? (styles["wide"] ?? "") : ""}`}
      >
        <nav aria-label="Путь навигации" className="pt-4">
          <Breadcrumbs
            items={[
              { label: "Главная", href: "/" },
              { label: "AI Engineering", href: "/products/ai-engineering" },
              { label: "Программа" },
            ]}
          />
        </nav>
        <header className={styles["header"]}>
          <div className={styles["headerTitle"]}>
            <CourseMark className="size-12 shrink-0" />
            <div>
              <h1>AI Engineering</h1>
              <p className={styles["meta"]}>
                8 глав · 48 материалов · всё открыто
              </p>
            </div>
          </div>
          <div className={styles["progressRow"]}>
            <span>
              Изучено {studied} из {allLessons.length}
            </span>
            <span>{Math.round((studied / allLessons.length) * 100)}%</span>
          </div>
          <div className={styles["bar"]}>
            <span
              style={{
                width: `${String((studied / allLessons.length) * 100)}%`,
              }}
            />
          </div>
        </header>
        {children}
      </div>
      <ProgrammeSections
        onOpen={(label) => {
          setNotice(`Прототип: здесь откроется раздел «${label}»`);
        }}
      />
      {notice === null ? null : (
        <div role="status" className={styles["toast"]}>
          {notice}
        </div>
      )}
    </div>
  );
}

// ---------- Variant A: tiles and a dialog ----------

function TilesWithDialog() {
  const [openId, setOpenId] = useState<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  const { toast, openLesson } = useToast();
  const index = chapters.findIndex((chapter) => chapter.id === openId);
  const chapter = index === -1 ? undefined : chapters[index];

  useEffect(() => {
    const element = dialog.current;
    if (element === null) return;
    if (chapter !== undefined && !element.open) element.showModal();
    if (chapter === undefined && element.open) element.close();
  }, [chapter]);

  const close = () => {
    setOpenId(null);
    opener.current?.focus();
  };
  const goLesson = (title: string) => {
    close();
    openLesson(title);
  };

  return (
    <ProgrammeShell>
      <h2 className={styles["sectionTitle"]}>Главы</h2>
      <div className={styles["grid"]}>
        {chapters.map((item) => (
          <Tile
            key={item.id}
            chapter={item}
            onOpen={(element) => {
              opener.current = element;
              setOpenId(item.id);
            }}
          />
        ))}
      </div>
      <dialog
        ref={dialog}
        className={styles["dialog"]}
        aria-labelledby="prototype-chapter-dialog-title"
        onClose={() => {
          if (openId !== null) close();
        }}
        onClick={(event) => {
          // A click on the backdrop lands on the dialog element itself.
          if (event.target === event.currentTarget) close();
        }}
      >
        {chapter === undefined ? null : (
          <>
            <div style={{ position: "relative" }}>
              <ChapterArt chapter={chapter} className={styles["dialogArt"]} />
              <button
                type="button"
                className={styles["dialogClose"]}
                aria-label="Закрыть"
                onClick={close}
              >
                <X size={18} />
              </button>
            </div>
            <div className={styles["dialogScroll"]}>
              <div>
                <p className={styles["eyebrow"]}>
                  Глава {index + 1}
                  {chapter.lessons.length === 0
                    ? ""
                    : ` · ${String(chapter.lessons.length)} ${lessonWord(chapter.lessons.length)}`}
                </p>
                <h2
                  id="prototype-chapter-dialog-title"
                  className={styles["dialogTitle"]}
                >
                  {chapter.name} <StatusBadge chapter={chapter} />
                </h2>
                <p className={styles["description"]} style={{ marginTop: 6 }}>
                  {chapter.description}
                </p>
              </div>
              <ChapterSummary chapter={chapter} />
              <div>
                <ChapterAction chapter={chapter} onLesson={goLesson} />
              </div>
              <LessonList chapter={chapter} onLesson={goLesson} />
            </div>
            <div className={styles["dialogFooter"]}>
              <button
                type="button"
                className={styles["ghost"]}
                disabled={index === 0}
                onClick={() => {
                  setOpenId(chapters[index - 1]?.id ?? null);
                }}
              >
                <ArrowLeft aria-hidden="true" size={16} /> Предыдущая
              </button>
              <button
                type="button"
                className={styles["ghost"]}
                disabled={index === chapters.length - 1}
                onClick={() => {
                  setOpenId(chapters[index + 1]?.id ?? null);
                }}
              >
                Следующая <ArrowRight aria-hidden="true" size={16} />
              </button>
            </div>
          </>
        )}
      </dialog>
      {toast}
    </ProgrammeShell>
  );
}

// ---------- Stories ----------

const environment = publicPageEnvironment(
  "/products/ai-engineering/programme",
  {
    account: "authenticated",
  },
);

const meta = {
  ...environment,
  title: "Prototypes/Главы курса плитками",
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** Клик по плитке открывает окно главы посередине экрана; на телефоне окно выезжает снизу. */
export const A_ПлиткиИОкно: Story = {
  name: "A. Плитки и окно главы",
  render: () => <TilesWithDialog />,
};

export const A_Телефон: Story = {
  name: "A. Телефон",
  render: () => <TilesWithDialog />,
  globals: { viewport: { value: "mobile390", isRotated: false } },
};
