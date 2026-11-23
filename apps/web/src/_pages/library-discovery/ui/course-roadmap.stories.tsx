import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ReactNode } from "react";
import { expect, userEvent, within } from "storybook/test";

import {
  MaterialReadingScope,
  type MaterialPreview,
} from "@/entities/material";
import type {
  ProductChapter,
  PublishedProductResult,
} from "@/features/library-discovery";
import { aiEngineeringCoursePage } from "@/storybook/ai-engineering-course.fixtures";
import { publicPageEnvironment } from "@/storybook/story-environment";

import { ProductLearningProvider } from "./product-learning.client";
import { ProductProgrammeView } from "./product-programme-view";

/**
 * Дорожная карта курса на вкладке «Программа» (#2141). Состав повторяет принятый прототип
 * `Prototypes/Course Roadmap` (решение владельца 13.11.2026): две готовые главы, глава в работе с
 * будущими уроками и четыре главы в планах. Названия уроков готовых глав условные.
 */

interface Lesson {
  readonly title: string;
  /** Video duration in seconds; a lesson without it is a text. */
  readonly video?: number;
}

const doneLessons: readonly (readonly Lesson[])[] = [
  [
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
  [
    { title: "Что сохранять для следующей работы агента" },
    { title: "Как разбирать сессии и улучшать harness" },
    { title: "Как передавать правила исполнителю и ревьюеру" },
    { title: "Как проверить пользу изменений harness" },
  ],
  [
    { title: "Проектирование до кода: что решить до первой задачи" },
    { title: "DDD: откуда взялся, из чего состоит и что из него брать" },
  ],
];

const upcomingLessons = [
  {
    title: "Бизнес-требования и сценарии: как разобрать процесс через события",
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
] as const;

const plannedChapters = [
  {
    name: "Тестирование, проверки, фидбэк и evals",
    outcome:
      "На реальном проекте проверяем работу агента тестами, ревью и evals, не читая каждую строку кода.",
    topics: [
      "Тесты, которым можно верить",
      "Проверка в живом приложении",
      "Proof of work: свидетельства работы в PR",
      "Независимое ревью",
      "Фидбэк агенту",
      "Evals",
    ],
  },
  {
    name: "Агенты в продакшене: инфраструктура и автоматизация",
    outcome:
      "Выкатываем реальный проект в продакшен и подключаем агентов к его работе: деплой, мониторинг, тикеты и поддержка.",
    topics: [
      "Сервер, окружения и секреты",
      "CI/CD и деплой",
      "Бэкапы и мониторинг",
      "Агент разбирает ошибки и инциденты",
      "Агент заводит задачи из фидбэка",
      "Агент отвечает на тикеты техподдержки",
    ],
  },
  {
    name: "Разработка агентов-помощников и встраивание их в продукты",
    outcome: "Пишем своего агента и встраиваем его в реальный продукт.",
    topics: [
      "Как устроены LLM и цикл агента",
      "Инструменты и tool calling",
      "RAG: поиск и подготовка контекста",
      "Память и сессии",
      "Безопасность: prompt injection и действия с подтверждением",
    ],
  },
  {
    name: "Software factory и оркестрация",
    outcome:
      "Собираем всё из курса в один рабочий процесс на реальном проекте: агенты берут задачи, пишут код, проверяют друг друга и доводят работу до мержа.",
    topics: [
      "Спецификации и деление на задачи",
      "Путь задачи от issue до мержа",
      "Параллельные агенты и оркестрация",
      "Роли агентов: исполнитель, ревьюер, проверяющий",
      "Права и песочницы для агентов",
      "Где решает человек",
    ],
  },
] as const;

function material(lesson: Lesson, ordinal: number): MaterialPreview {
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
  };
}

/** Lessons of the given chapters, numbered across the whole programme. */
function publish(chapters: readonly (readonly Lesson[])[]) {
  let ordinal = 0;
  return chapters.map((lessons) =>
    lessons.map((lesson) => {
      ordinal += 1;
      return material(lesson, ordinal);
    }),
  );
}

const doneNames = [
  "Подготовка проекта и первый цикл разработки с агентом",
  "Как улучшать работу агента и harness",
] as const;
const writingName =
  "Проектирование до кода: предметная область, DDD и границы модулей";

type RoadmapResult = Extract<PublishedProductResult, { kind: "ready" }>;

const reference = {
  name: "AI Engineering",
  slug: "ai-engineering",
  summary: "",
  productPage: {
    presentation: "ai-engineering-course",
    page: aiEngineeringCoursePage,
  },
  roadmapUpdatedOn: "2026-11-13",
} as const;

function programme({
  allDone = false,
  planned = true,
  roadmap = true,
}: {
  readonly allDone?: boolean;
  readonly planned?: boolean;
  readonly roadmap?: boolean;
} = {}): RoadmapResult {
  const lessons = publish(
    allDone
      ? [
          ...doneLessons.slice(0, 2),
          [...(doneLessons[2] ?? []), ...upcomingLessons],
          ...plannedChapters.map((chapter) =>
            chapter.topics.map((title) => ({ title })),
          ),
        ]
      : doneLessons,
  );
  const ids = (index: number) =>
    (lessons[index] ?? []).flatMap((item) =>
      item.materialId === undefined ? [] : [item.materialId],
    );
  const chapters: ProductChapter[] = [
    ...doneNames.map((name, index) => ({
      id: `roadmap-done-${String(index + 1)}`,
      name,
      summary: "",
      materialIds: ids(index),
      ...(roadmap ? { roadmapStatus: "done" as const } : {}),
    })),
    {
      id: "roadmap-writing",
      name: writingName,
      summary: "",
      materialIds: ids(2),
      ...(roadmap && !allDone
        ? { roadmapStatus: "writing" as const, upcomingLessons }
        : roadmap
          ? { roadmapStatus: "done" as const }
          : {}),
    },
    ...(planned
      ? plannedChapters.map((chapter, index) => ({
          id: `roadmap-planned-${String(index + 1)}`,
          name: chapter.name,
          summary: `${chapter.outcome}\n\n${chapter.topics.map((topic) => `- ${topic}`).join("\n")}`,
          materialIds: allDone ? ids(index + 3) : [],
          // A stored roadmap may leave a chapter without a status: the page derives it.
          ...(roadmap && index === 0 && !allDone
            ? { roadmapStatus: "planned" as const }
            : {}),
        }))
      : []),
  ];
  const { roadmapUpdatedOn, ...withoutRoadmap } = reference;
  return {
    kind: "ready",
    discoveryKind: "product",
    hasNext: false,
    chapters,
    items: lessons.flat(),
    reference: roadmap
      ? { ...withoutRoadmap, roadmapUpdatedOn }
      : withoutRoadmap,
    relatedProduct: [],
    topics: [],
  };
}

const register = () => () => undefined;
const refresh = () => Promise.resolve();
const environment = publicPageEnvironment("/products/ai-engineering/programme");

/** The reader finished the first nine lessons; nothing else is in progress. */
function ReadingScope({
  items,
  read,
  children,
}: {
  readonly items: readonly MaterialPreview[];
  readonly read: number;
  readonly children: ReactNode;
}) {
  return (
    <MaterialReadingScope
      value={{
        accountId: "story-account",
        resolved: true,
        states: new Map(
          items.map((item, index) => [
            item.materialId ?? "",
            { isRead: index < read, version: 1 },
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
          read,
          total: items.length,
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
  component: ProductProgrammeView,
  title: "Pages/Product/Programme/Course roadmap",
  parameters: {
    ...environment.parameters,
    docs: {
      description: {
        component:
          "Дорожная карта курса на вкладке «Программа» (#2141): готовые главы, глава в работе с будущими уроками и главы в планах. Главы стоят плитками, уроки главы открываются в её окне.",
      },
    },
  },
  args: { result: programme(), productOpen: true },
  render: (args) => (
    <ReadingScope
      items={args.result.kind === "ready" ? args.result.items : []}
      read={9}
    >
      <ProductProgrammeView {...args} />
    </ReadingScope>
  ),
  decorators: [...environment.decorators],
} satisfies Meta<typeof ProductProgrammeView>;
export default meta;
type Story = StoryObj<typeof meta>;

const mobile = { viewport: { value: "mobile390", isRotated: false } };

function tile(canvasElement: HTMLElement, name: string): HTMLElement {
  const match = [
    ...canvasElement.querySelectorAll<HTMLElement>("[data-chapter-tile]"),
  ].find((candidate) => candidate.textContent.includes(name));
  if (match === undefined) throw new Error(`Missing tile «${name}»`);
  return match;
}

function chapterWindow(): HTMLDialogElement {
  const dialog = document.querySelector<HTMLDialogElement>(
    "dialog[data-chapter-window]",
  );
  if (dialog === null) throw new Error("Missing chapter window");
  return dialog;
}

/** Две главы готовы, третья пишется, четыре в планах: семь плиток с метками статуса. */
export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const progress = canvas.getByRole("progressbar", {
      name: "Прогресс продукта",
    });
    await expect(progress).toBeVisible();
    await expect(progress).toHaveAttribute("value", "9");
    await expect(
      canvasElement.querySelectorAll("[data-chapter-tile]"),
    ).toHaveLength(7);
    await expect(
      canvasElement.querySelectorAll('[data-chapter-badge="writing"]'),
    ).toHaveLength(1);
    await expect(
      canvasElement.querySelectorAll('[data-chapter-badge="planned"]'),
    ).toHaveLength(4);
    // A tile counts what the reader studied in its chapter.
    await expect(
      canvas.getByLabelText(
        `Изучено 9 из 13 материалов главы «${doneNames[0]}»`,
      ),
    ).toBeVisible();
    // Lessons wait for the chapter window.
    await expect(
      canvasElement.querySelectorAll("[data-route-material]"),
    ).toHaveLength(0);
    // Long titles wrap: nothing in the programme scrolls sideways.
    await expect(document.documentElement.scrollWidth).toBe(
      document.documentElement.clientWidth,
    );
  },
};
export const DefaultMobile: Story = { ...Default, globals: mobile };

/**
 * Окно главы в работе: готовые уроки, затем объявленные. Стрелка ведёт к следующей главе, Esc
 * закрывает окно и возвращает фокус на плитку.
 */
export const ChapterWindow: Story = {
  play: async ({ canvasElement }) => {
    const writing = tile(canvasElement, writingName);
    await userEvent.click(writing);
    const dialog = chapterWindow();
    await expect(dialog.open).toBe(true);
    const window_ = within(dialog);
    await expect(
      window_.getByRole("heading", {
        level: 2,
        name: /^Проектирование до кода/u,
      }),
    ).toHaveFocus();
    await expect(window_.getByText(/готово 2 из 7 уроков/u)).toBeVisible();
    await expect(
      window_.getByRole("list", { name: `Материалы главы «${writingName}»` }),
    ).toBeVisible();
    await expect(
      dialog.querySelectorAll("[data-roadmap-upcoming]"),
    ).toHaveLength(5);
    await expect(
      window_.getByRole("heading", {
        level: 3,
        name: /^Бизнес-требования и сценарии/u,
      }),
    ).toBeVisible();
    await userEvent.click(window_.getByRole("button", { name: /^Следующая/u }));
    await expect(
      window_.getByRole("heading", {
        level: 2,
        name: /^Тестирование, проверки/u,
      }),
    ).toBeVisible();
    await expect(
      window_.getByText("Proof of work: свидетельства работы в PR"),
    ).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await expect(dialog.open).toBe(false);
    await expect(
      tile(canvasElement, "Тестирование, проверки, фидбэк и evals"),
    ).toHaveFocus();
  },
};
export const ChapterWindowMobile: Story = { ...ChapterWindow, globals: mobile };

/** Курс дописан: все главы готовы, меток «Пишется» и «В планах» нет. */
export const AllDone: Story = {
  args: { result: programme({ allDone: true }) },
  play: async ({ canvasElement }) => {
    await expect(
      canvasElement.querySelectorAll("[data-chapter-tile]"),
    ).toHaveLength(7);
    await expect(
      canvasElement.querySelectorAll(
        '[data-chapter-badge="writing"], [data-chapter-badge="planned"]',
      ),
    ).toHaveLength(0);
  },
};

/** Глава пишется, но о следующих ничего не объявлено. */
export const NoPlanned: Story = {
  args: { result: programme({ planned: false }) },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByRole("progressbar", {
        name: "Прогресс продукта",
      }),
    ).toBeVisible();
    await expect(
      canvasElement.querySelectorAll('[data-chapter-status="planned"]'),
    ).toHaveLength(0);
  },
};

/** Дорожной карты нет: глава с уроками готова, глава без уроков показана запланированной. */
export const NoRoadmap: Story = {
  args: { result: programme({ roadmap: false }) },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByRole("progressbar", {
        name: "Прогресс продукта",
      }),
    ).toHaveAttribute("value", "9");
    await expect(
      canvasElement.querySelectorAll('[data-chapter-status="done"]'),
    ).toHaveLength(3);
    await expect(
      canvasElement.querySelectorAll('[data-chapter-badge="planned"]'),
    ).toHaveLength(4);
  },
};
export const NoRoadmapMobile: Story = { ...NoRoadmap, globals: mobile };

export const Guest: Story = {
  render: (args) => (
    <ProductLearningProvider learning={{ kind: "guest" }}>
      <ProductProgrammeView {...args} />
    </ProductLearningProvider>
  ),
  play: async ({ canvasElement }) => {
    const header = canvasElement.querySelector<HTMLElement>(
      '[data-programme-part="header"]',
    );
    if (!header) throw new Error("Ожидалась шапка программы");
    await expect(within(header).queryByRole("progressbar")).toBeNull();
  },
};
