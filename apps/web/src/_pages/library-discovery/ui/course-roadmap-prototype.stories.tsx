import type { Meta, StoryObj } from "@storybook/react-vite";
import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import { expect, userEvent, within } from "storybook/test";

import {
  MaterialCard,
  MaterialReadingScope,
  type MaterialPreview,
} from "@/entities/material";
import { CourseMark } from "@/features/ai-engineering-course";
import { ProductMaterialMarker } from "@/features/reading-progress";
import { cn } from "@/shared/lib/utils";
import { Breadcrumbs } from "@/shared/ui/breadcrumbs";
import { publicPageEnvironment } from "@/storybook/story-environment";
import { ProductLearningProvider } from "./product-learning.client";
import "./course-programme-overview.css";
import "./product-programme-view.css";

// Throwaway (owner request 2026-11-13): learners ask which course topics are still coming and when.
// The owner picked variant A «Список с метками» of four HTML sketches and asked to add «Обновлено …»
// from another sketch. Second pass 2026-11-13: no «Готово» or «Следующая» badges, fewer chapters,
// no parts (the product only has chapters).
// Fixture data only; nothing in production imports this file. Lesson titles of
// the two finished chapters and the outcome lines of later chapters are placeholders for the picture.
// The production version needs chapter status, lesson status, outcome line, topics and an
// update date in the presentation contract (see docs/evidence/course-roadmap/README.md).

interface ReadyLesson {
  readonly title: string;
  /** Video duration in seconds; a lesson without it is a text. */
  readonly video?: number;
}

interface UpcomingLesson {
  readonly title: string;
  readonly state: "writing" | "soon";
}

type RoadmapChapter =
  | {
      readonly kind: "done";
      readonly name: string;
      readonly lessons: readonly ReadyLesson[];
    }
  | {
      readonly kind: "writing";
      readonly name: string;
      readonly lessons: readonly (ReadyLesson | UpcomingLesson)[];
    }
  | {
      readonly kind: "planned";
      readonly name: string;
      readonly outcome: string;
      readonly topics: readonly string[];
    };

interface Roadmap {
  readonly updated: string;
  readonly chapters: readonly RoadmapChapter[];
  /** How many first published lessons the reader has finished. */
  readonly read: number;
}

const firstChapter: RoadmapChapter = {
  kind: "done",
  name: "Подготовка проекта и первый цикл разработки с агентом",
  lessons: [
    { title: "Как устроен курс" },
    { title: "Выбор агента и модели", video: 563 },
    {
      title: "Как агент работает с проектом: контекст, инструменты и harness",
      video: 427,
    },
    { title: "Подготовка проекта: инструкции, скиллы и репозиторий" },
    { title: "Практика: начинаем работу с агентом в проекте", video: 1512 },
    { title: "Первая версия продукта: сценарии и границы", video: 256 },
    { title: "Практика: проектирование с агентом через grilling", video: 1420 },
    { title: "Домен и общий язык" },
    { title: "Выбор стека и границ модулей" },
    {
      title: "Практика: от спецификации к работающему приложению",
      video: 2075,
    },
    { title: "Настройка тестов, проверок архитектуры и CI", video: 1858 },
    { title: "Итоги: готовность проекта к разработке функций" },
    { title: "Готовый харнесс для разработки", video: 1283 },
  ],
};
const secondChapter: RoadmapChapter = {
  kind: "done",
  name: "Как улучшать работу агента и harness",
  lessons: [
    { title: "Что сохранять для следующей работы агента" },
    { title: "Как разбирать сессии и улучшать harness" },
    { title: "Как передавать правила исполнителю и ревьюеру" },
    { title: "Как проверить пользу изменений harness" },
  ],
};
const designChapter: RoadmapChapter = {
  kind: "writing",
  name: "Проектирование до кода: предметная область, DDD и границы модулей",
  lessons: [
    { title: "Проектирование до кода: что решить до первой задачи" },
    { title: "DDD: откуда взялся, из чего состоит и что из него брать" },
    {
      title:
        "Бизнес-требования и сценарии: как разобрать процесс через события",
      state: "writing",
    },
    {
      title: "Сессия с агентом: как вместе разобрать предметную область",
      state: "soon",
    },
    {
      title: "Границы модулей: как делить систему и как модули общаются",
      state: "soon",
    },
    {
      title: "Технические требования и решения, которые дорого менять",
      state: "soon",
    },
    { title: "Спецификация, срезы и когда остановиться", state: "soon" },
  ],
};
const planned = (
  name: string,
  outcome: string,
  topics: readonly string[],
): RoadmapChapter => ({ kind: "planned", name, outcome, topics });

const fullRoadmap: Roadmap = {
  updated: "13 ноября",
  read: 9,
  chapters: [
    firstChapter,
    secondChapter,
    designChapter,
    planned(
      "Тестирование, проверки, фидбэк и evals",
      "Как проверить работу агента тестами, ревью и evals, не читая каждую строку кода.",
      [
        "Тесты, которым можно верить",
        "Проверка в живом приложении",
        "Proof of work: свидетельства работы в PR",
        "Независимое ревью",
        "Фидбэк агенту",
        "Evals",
      ],
    ),
    planned(
      "Практика: разработка реального проекта с агентами",
      "Делаем с агентами несколько проектов от идеи до работающей версии.",
      ["Спецификации и деление на задачи", "Параллельные агенты"],
    ),
    planned(
      "Агенты в продакшене: инфраструктура и автоматизация",
      "Выкатываем проект в продакшен и подключаем агентов к его работе: деплой, мониторинг, тикеты и поддержка.",
      [
        "Сервер, окружения и секреты",
        "CI/CD и деплой",
        "Бэкапы и мониторинг",
        "Агент разбирает ошибки и инциденты",
        "Агент заводит задачи из фидбэка",
        "Агент отвечает на тикеты техподдержки",
      ],
    ),
    planned(
      "Разработка агентов-помощников и встраивание их в продукты",
      "Пишем своего агента и встраиваем его в продукт.",
      [
        "Как устроены LLM и цикл агента",
        "Инструменты и tool calling",
        "RAG: поиск и подготовка контекста",
        "Память и сессии",
        "Безопасность: prompt injection и действия с подтверждением",
      ],
    ),
    planned(
      "Software factory и оркестрация",
      "Собираем всё из курса в один рабочий процесс: агенты берут задачи, пишут код, проверяют друг друга и доводят работу до мержа.",
      [
        "Путь задачи от issue до мержа",
        "Оркестрация нескольких агентов",
        "Роли агентов: исполнитель, ревьюер, проверяющий",
        "Права и песочницы для агентов",
        "Где решает человек",
      ],
    ),
  ],
};

/** Every chapter finished: planned topics become the published lessons. */
const allDoneRoadmap: Roadmap = {
  ...fullRoadmap,
  read: 17,
  chapters: fullRoadmap.chapters.map((chapter): RoadmapChapter =>
    chapter.kind === "done"
      ? chapter
      : {
          kind: "done",
          name: chapter.name,
          lessons:
            chapter.kind === "writing"
              ? chapter.lessons.map(({ title }) => ({ title }))
              : chapter.topics.map((title) => ({ title })),
        },
  ),
};

/** The course is still being written, but nothing is announced beyond the current chapter. */
const noPlannedRoadmap: Roadmap = {
  ...fullRoadmap,
  chapters: fullRoadmap.chapters.filter(
    (chapter) => chapter.kind !== "planned",
  ),
};

const isReady = (lesson: ReadyLesson | UpcomingLesson): lesson is ReadyLesson =>
  !("state" in lesson);

function material(
  lesson: ReadyLesson,
  ordinal: number,
  readUntil: number,
): MaterialPreview & { readonly isRead: boolean } {
  const id = `roadmap-lesson-${String(ordinal)}`;
  return {
    materialId: id,
    slug: id,
    title: lesson.title,
    access: "closed",
    availability: "available",
    format: lesson.video === undefined ? "Гайд" : "Видео",
    formatSlug: lesson.video === undefined ? "guide" : "video",
    ...(lesson.video === undefined
      ? {}
      : { primaryVideoDurationSeconds: lesson.video }),
    summary: "",
    topic: "AI Engineering",
    topicSlug: "ai-engineering",
    tags: [],
    productMemberships: [
      { name: "AI Engineering", slug: "ai-engineering", ordinal },
    ],
    isRead: ordinal <= readUntil,
  };
}

/** Lessons of the whole roadmap with their programme ordinal; future lessons keep their place. */
function numbered(roadmap: Roadmap) {
  let ordinal = 0;
  return roadmap.chapters.map((chapter) => ({
    chapter,
    lessons:
      chapter.kind === "planned"
        ? []
        : chapter.lessons.map((lesson) => {
            ordinal += 1;
            return isReady(lesson)
              ? {
                  kind: "ready" as const,
                  material: material(lesson, ordinal, roadmap.read),
                  ordinal,
                }
              : { kind: "upcoming" as const, lesson, ordinal };
          }),
  }));
}

const plural = (n: number, one: string, few: string, many: string) => {
  const mod10 = n % 10;
  const mod100 = n % 100;
  const word =
    mod10 === 1 && mod100 !== 11
      ? one
      : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)
        ? few
        : many;
  return `${String(n)} ${word}`;
};

const badgeTone = {
  writing:
    "bg-[color-mix(in_oklch,var(--accent)_12%,var(--background))] text-action",
  planned: "bg-secondary text-muted-foreground",
} as const;

function StatusBadge({
  tone,
  children,
}: {
  readonly tone: keyof typeof badgeTone;
  readonly children: ReactNode;
}) {
  // A plain space instead of a margin: when the badge wraps, it starts flush with the title.
  return (
    <>
      {" "}
      <span
        className={cn(
          "inline-flex translate-y-[-0.1em] items-center gap-1.5 rounded-full px-2 py-0.5 align-middle text-[0.6875rem] font-semibold leading-4 whitespace-nowrap sm:text-xs",
          badgeTone[tone],
        )}
        data-roadmap-badge={tone}
      >
        {tone === "writing" ? (
          <span
            aria-hidden="true"
            className="size-1.5 rounded-full bg-accent"
          />
        ) : null}
        {children}
      </span>
    </>
  );
}

const chapterTitleClass =
  "inline text-base font-semibold leading-snug tracking-[-0.02em] [overflow-wrap:anywhere] sm:text-xl";

function RoadmapProgress({ roadmap }: { readonly roadmap: Roadmap }) {
  const chapters = roadmap.chapters;
  const done = chapters.filter((chapter) => chapter.kind === "done").length;
  const summary = [`Готово ${plural(done, "глава", "главы", "глав")}`];
  return (
    <div className="mt-4 border-t border-border/70 pt-4" data-roadmap-progress>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-sm">
        <p className="font-medium">
          {summary.map((part, index) => (
            <span
              className={index === 0 ? undefined : "text-muted-foreground"}
              key={part}
            >
              {index === 0 ? null : " · "}
              {part}
            </span>
          ))}
        </p>
        <p className="text-xs text-muted-foreground">
          Обновлено {roadmap.updated}
        </p>
      </div>
      <div
        aria-hidden="true"
        className="mt-3 flex gap-[3px]"
        data-roadmap-segments
      >
        {chapters.map((chapter) => {
          const share =
            chapter.kind === "writing"
              ? chapter.lessons.filter(isReady).length / chapter.lessons.length
              : chapter.kind === "done"
                ? 1
                : 0;
          return (
            <span
              className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-border"
              key={chapter.name}
            >
              <span
                className={cn(
                  "absolute inset-y-0 left-0 rounded-full",
                  chapter.kind === "writing" ? "bg-accent" : "bg-primary",
                )}
                style={{ width: `${String(share * 100)}%` }}
              />
            </span>
          );
        })}
      </div>
    </div>
  );
}

function ReadyLessonRow({
  material: lesson,
  ordinal,
}: {
  readonly material: MaterialPreview;
  readonly ordinal: number;
}) {
  return (
    <li className="@container/series-entry relative min-w-0 rounded-xl">
      <MaterialCard
        headingLevel="h4"
        material={lesson}
        productOpen
        productOrdinal={ordinal}
        readingStatus={
          <ProductMaterialMarker
            {...(lesson.materialId === undefined
              ? {}
              : { materialId: lesson.materialId })}
            ordinal={ordinal}
          />
        }
        variant="product"
      />
    </li>
  );
}

/** A lesson that is not published yet: same row geometry, no link, dashed outline. */
function UpcomingLessonRow({
  lesson,
  ordinal,
}: {
  readonly lesson: UpcomingLesson;
  readonly ordinal: number;
}) {
  return (
    <li
      aria-disabled="true"
      className="flex min-h-14 min-w-0 items-center gap-2 rounded-xl border border-dashed border-foreground/20 px-3 py-2.5 text-muted-foreground sm:gap-3 sm:px-4"
      data-roadmap-upcoming={lesson.state}
    >
      <span
        aria-hidden="true"
        className="w-4 shrink-0 text-left text-xs font-semibold leading-5 tabular-nums sm:w-7 sm:text-center sm:text-lg sm:leading-6"
      >
        {ordinal}
      </span>
      <div className="min-w-0 flex-1">
        <h4 className="text-sm font-medium leading-5 [overflow-wrap:anywhere] sm:text-base sm:leading-6">
          {lesson.title}
        </h4>
        <span className="mt-1 flex items-center gap-1.5 text-xs leading-4">
          {lesson.state === "writing" ? (
            <>
              <span
                aria-hidden="true"
                className="size-1.5 rounded-full bg-accent"
              />
              <span className="font-medium text-action">Пишется</span>
            </>
          ) : (
            "Скоро"
          )}
        </span>
      </div>
    </li>
  );
}

type NumberedChapter = ReturnType<typeof numbered>[number];

/**
 * Every chapter folds the same way: the summary keeps the title, the badge and one line; the body
 * holds the lessons or the topics. Only the chapter in work starts open.
 */
function ChapterDisclosure({
  kind,
  title,
  badge,
  line,
  open = false,
  children,
}: {
  readonly kind: RoadmapChapter["kind"];
  readonly title: string;
  readonly badge?: ReactNode;
  readonly line: ReactNode;
  readonly open?: boolean;
  readonly children: ReactNode;
}) {
  return (
    <details className="group/chapter" data-roadmap-chapter={kind} open={open}>
      <summary className="flex cursor-pointer list-none items-start justify-between gap-4 rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
        <div className="min-w-0 flex-1">
          <h3
            className={cn(
              chapterTitleClass,
              kind === "planned" &&
                "text-[0.9375rem] text-foreground/85 sm:text-lg",
            )}
          >
            {title}
          </h3>
          {badge}
          <p className="mt-1.5 text-sm leading-6 text-muted-foreground">
            {line}
          </p>
        </div>
        <ChevronDown
          aria-hidden="true"
          className="mt-1.5 size-4 shrink-0 text-muted-foreground transition-transform group-open/chapter:rotate-180"
        />
      </summary>
      {children}
    </details>
  );
}

function DoneChapter({ entry }: { readonly entry: NumberedChapter }) {
  const lessons = entry.lessons.flatMap((lesson) =>
    lesson.kind === "ready" ? [lesson] : [],
  );
  const read = lessons.filter(({ material: item }) => item.isRead).length;
  return (
    <ChapterDisclosure
      kind="done"
      line={`Изучено ${String(read)} из ${String(lessons.length)}`}
      title={entry.chapter.name}
    >
      <ol
        aria-label={`Материалы главы «${entry.chapter.name}»`}
        className="mt-3 grid gap-2"
        start={lessons[0]?.ordinal ?? 1}
      >
        {lessons.map((lesson) => (
          <ReadyLessonRow
            key={lesson.ordinal}
            material={lesson.material}
            ordinal={lesson.ordinal}
          />
        ))}
      </ol>
    </ChapterDisclosure>
  );
}

function WritingChapter({ entry }: { readonly entry: NumberedChapter }) {
  const ready = entry.lessons.filter((lesson) => lesson.kind === "ready");
  return (
    <ChapterDisclosure
      badge={<StatusBadge tone="writing">Пишется</StatusBadge>}
      kind="writing"
      line={`Готово ${String(ready.length)} из ${plural(entry.lessons.length, "урока", "уроков", "уроков")}`}
      open
      title={entry.chapter.name}
    >
      <ol
        aria-label={`Материалы главы «${entry.chapter.name}»`}
        className="mt-3 grid gap-2"
        start={entry.lessons[0]?.ordinal ?? 1}
      >
        {entry.lessons.map((lesson) =>
          lesson.kind === "ready" ? (
            <ReadyLessonRow
              key={lesson.ordinal}
              material={lesson.material}
              ordinal={lesson.ordinal}
            />
          ) : (
            <UpcomingLessonRow
              key={lesson.ordinal}
              lesson={lesson.lesson}
              ordinal={lesson.ordinal}
            />
          ),
        )}
      </ol>
    </ChapterDisclosure>
  );
}

function PlannedChapter({
  chapter,
}: {
  readonly chapter: Extract<RoadmapChapter, { kind: "planned" }>;
}) {
  return (
    <ChapterDisclosure
      badge={<StatusBadge tone="planned">В планах</StatusBadge>}
      kind="planned"
      line={chapter.outcome}
      title={chapter.name}
    >
      <ul
        aria-label={`Темы главы «${chapter.name}»`}
        className="mt-3 flex flex-wrap gap-1.5"
      >
        {chapter.topics.map((topic) => (
          <li
            className="rounded-full bg-secondary px-2.5 py-1 text-xs leading-4 text-foreground/80"
            key={topic}
          >
            {topic}
          </li>
        ))}
      </ul>
    </ChapterDisclosure>
  );
}

function CourseRoadmapPage({ roadmap }: { readonly roadmap: Roadmap }) {
  const entries = numbered(roadmap);
  const published = entries
    .flatMap((entry) => entry.lessons)
    .filter((lesson) => lesson.kind === "ready");
  const chapterCount = entries.length;
  return (
    <div
      className="@container/programme mx-auto w-full max-w-[46rem] min-w-0"
      data-roadmap-variant="A"
    >
      <nav
        aria-label="Путь навигации"
        className="-mt-3 flex flex-wrap items-center justify-between gap-x-3 sm:mt-0 sm:pt-4"
      >
        <Breadcrumbs
          items={[
            { label: "Главная", href: "/" },
            { label: "AI Engineering", href: "/products/ai-engineering" },
            { label: "Программа" },
          ]}
        />
      </nav>
      <header className="relative mt-2 rounded-2xl bg-muted/60 p-4 sm:p-5">
        <div className="flex min-w-0 items-center gap-3">
          <CourseMark className="size-10 shrink-0 sm:size-12" />
          <div className="min-w-0">
            <h1 className="text-xl font-semibold leading-tight tracking-[-0.025em] sm:text-2xl">
              AI Engineering
            </h1>
            <p className="mt-1 text-xs leading-5 text-muted-foreground sm:text-sm">
              {plural(chapterCount, "глава", "главы", "глав")} ·{" "}
              {plural(published.length, "урок", "урока", "уроков")} · всё
              открыто
            </p>
          </div>
        </div>
        <RoadmapProgress roadmap={roadmap} />
      </header>

      <section aria-label="Программа" className="mt-8 grid gap-6">
        {entries.map((entry) => (
          <section
            className="programme-chapter"
            data-chapter-state={
              entry.chapter.kind === "planned" ? "preparing" : "open"
            }
            key={entry.chapter.name}
          >
            <div className="programme-chapter-head">
              {entry.chapter.kind === "done" ? (
                <DoneChapter entry={entry} />
              ) : entry.chapter.kind === "writing" ? (
                <WritingChapter entry={entry} />
              ) : (
                <PlannedChapter chapter={entry.chapter} />
              )}
            </div>
          </section>
        ))}
      </section>
    </div>
  );
}

const register = () => () => undefined;
const refresh = () => Promise.resolve();
const environment = publicPageEnvironment("/products/ai-engineering/programme");

function ReadingScope({
  roadmap,
  children,
}: {
  readonly roadmap: Roadmap;
  readonly children: ReactNode;
}) {
  const lessons = numbered(roadmap)
    .flatMap((entry) => entry.lessons)
    .flatMap((lesson) => (lesson.kind === "ready" ? [lesson.material] : []));
  return (
    <MaterialReadingScope
      value={{
        accountId: "story-account",
        resolved: true,
        states: new Map(
          lessons.map((item) => [
            item.materialId ?? "",
            { isRead: item.isRead, version: 1 },
          ]),
        ),
        register,
        refresh,
        failed: false,
      }}
    >
      <ProductLearningProvider
        learning={{
          kind: "ready",
          read: roadmap.read,
          total: lessons.length,
          continuation: null,
        }}
      >
        {children}
      </ProductLearningProvider>
    </MaterialReadingScope>
  );
}

const meta = {
  ...environment,
  title: "Prototypes/Course Roadmap",
  parameters: {
    ...environment.parameters,
    docs: {
      description: {
        component:
          "Прототип дорожной карты курса на вкладке «Программа», вариант A «Список с метками». Только тестовые данные.",
      },
    },
  },
  args: { roadmap: fullRoadmap },
  render: ({ roadmap }) => (
    <ReadingScope roadmap={roadmap}>
      <CourseRoadmapPage roadmap={roadmap} />
    </ReadingScope>
  ),
  decorators: [...environment.decorators],
} satisfies Meta<{ readonly roadmap: Roadmap }>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Две главы готовы, третья пишется, девять в планах. */
export const Default: Story = {};
export const DefaultMobile: Story = {
  globals: { viewport: { value: "mobile390", isRotated: false } },
};

/** Раскрыты готовая глава и темы первой главы в планах. */
export const Expanded: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      canvas.getByRole("heading", {
        name: "Как улучшать работу агента и harness",
      }),
    );
    await expect(
      canvas.getByRole("list", {
        name: "Материалы главы «Как улучшать работу агента и harness»",
      }),
    ).toBeVisible();
    const next = canvasElement.querySelector<HTMLElement>(
      '[data-roadmap-chapter="planned"] summary',
    );
    if (next === null) throw new Error("Missing planned chapter topics");
    await userEvent.click(next);
    await expect(
      canvas.getByText("Proof of work: свидетельства работы в PR"),
    ).toBeVisible();
  },
};
export const ExpandedMobile: Story = {
  ...Expanded,
  globals: { viewport: { value: "mobile390", isRotated: false } },
};

/** Глава в работе тоже сворачивается: вся программа помещается на один экран. */
export const AllCollapsed: Story = {
  play: async ({ canvasElement }) => {
    const writing = canvasElement.querySelector<HTMLDetailsElement>(
      '[data-roadmap-chapter="writing"]',
    );
    const summary = writing?.querySelector("summary");
    if (writing == null || summary == null)
      throw new Error("Missing chapter in work");
    await userEvent.click(summary);
    await expect(writing.open).toBe(false);
    await expect(
      canvasElement.querySelectorAll("details[data-roadmap-chapter][open]"),
    ).toHaveLength(0);
  },
};
export const AllCollapsedMobile: Story = {
  ...AllCollapsed,
  globals: { viewport: { value: "mobile390", isRotated: false } },
};

/** Курс дописан: все главы готовы и свёрнуты, меток «Пишется» и «В планах» нет. */
export const AllDone: Story = { args: { roadmap: allDoneRoadmap } };

/** Глава пишется, но о следующих ничего не объявлено. */
export const NoPlanned: Story = { args: { roadmap: noPlannedRoadmap } };
