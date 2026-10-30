import {
  courseReadingContext,
  type CourseReadingContext,
} from "@/features/library-discovery";

export const courseSource = {
  kind: "ready" as const,
  reference: {
    slug: "ai-engineering",
    name: "AI Engineering",
    hasModeVariants: false,
  },
  items: [
    {
      materialId: "00000000-0000-4000-8000-0000000000a1",
      slug: "aie-project",
      title: "Описание проекта",
      availability: "available" as const,
    },
    {
      materialId: "00000000-0000-4000-8000-0000000000a2",
      slug: "first",
      title: "Первый урок",
      availability: "available" as const,
    },
    {
      materialId: "00000000-0000-4000-8000-0000000000a3",
      slug: "course-intro",
      title: "Как устроен курс",
      availability: "available" as const,
    },
    {
      materialId: "00000000-0000-4000-8000-0000000000a4",
      slug: "next",
      title: "Следующий урок",
      availability: "locked" as const,
    },
    {
      materialId: "00000000-0000-4000-8000-0000000000a5",
      slug: "aie-product-brief",
      title: "Бриф заказчика",
      availability: "available" as const,
    },
  ],
  chapters: [
    {
      supplementaryMaterialIds: [
        "00000000-0000-4000-8000-0000000000a1",
        "00000000-0000-4000-8000-0000000000a5",
      ],
      id: "start",
      name: "Подготовь проект к разработке с агентом и проверь настройку",
      materialIds: [
        "00000000-0000-4000-8000-0000000000a2",
        "00000000-0000-4000-8000-0000000000a3",
      ],
      tasks: [
        {
          code: "aie-ch1-onboarding",
          title: "Онбординг нового разработчика за час",
          access: "closed" as const,
          availability: "available" as const,
          afterMaterialId: "00000000-0000-4000-8000-0000000000a3",
          lastSubmittedAt: null,
        },
      ],
    },
    {
      id: "continue",
      name: "Продолжение",
      materialIds: ["00000000-0000-4000-8000-0000000000a4"],
      tasks: [],
    },
    { id: "soon", name: "Следующая глава", materialIds: [], tasks: [] },
  ],
} as const;

function requiredContext(
  value: CourseReadingContext | null,
): CourseReadingContext {
  if (value === null)
    throw new Error("Course fixture must contain its current step");
  return value;
}
export const courseGuide = requiredContext(
  courseReadingContext({
    product: courseSource,
    current: { kind: "material", slug: "course-intro" },
  }),
);
export const courseTask = requiredContext(
  courseReadingContext({
    product: courseSource,
    current: { kind: "task", code: "aie-ch1-onboarding" },
  }),
);
export const taskOnlyCourse = requiredContext(
  courseReadingContext({
    product: {
      ...courseSource,
      kind: "empty",
      items: [],
      chapters: [{ ...courseSource.chapters[0], materialIds: [] }],
    },
    current: { kind: "task", code: "aie-ch1-onboarding" },
  }),
);

export const courseNext = requiredContext(
  courseReadingContext({
    product: courseSource,
    current: { kind: "material", slug: "next" },
  }),
);

const progressTitles = [
  "Как устроен курс",
  "Выбор агента и модели",
  "Как агент работает с проектом: контекст, инструменты и harness",
  "Подготовка проекта: инструкции, скиллы и репозиторий",
  "Практика: начинаем работу с агентом в проекте",
  "Первая версия продукта: сценарии и границы",
  "Практика: проектирование с агентом через grilling",
  "Домен и общий язык",
  "Выбор стека и границ модулей",
  "Практика: от спецификации к работающему приложению",
  "Настройка тестов, проверок архитектуры и CI",
  "Итоги: готовность проекта к разработке функций",
] as const;
const progressMaterialId = (index: number) => `progress-${String(index)}`;
const laterChapters = [
  ["Разработка с агентами: от требований до проверенного результата", 3],
  ["Релизы и эксплуатация: CI/CD, данные и наблюдаемость", 2],
  ["Инфраструктура агентов: контекст, MCP и общий harness", 2],
] as const;

/** A first chapter in the middle of study: one lesson skipped, one task submitted, more chapters ahead. */
export const progressCourse = requiredContext(
  courseReadingContext({
    product: {
      kind: "ready",
      reference: {
        slug: "ai-engineering",
        name: "AI Engineering",
        hasModeVariants: false,
      },
      items: [
        ...progressTitles.map((title, index) => ({
          materialId: progressMaterialId(index),
          slug: `progress-${String(index)}`,
          title,
          availability: "available" as const,
        })),
        ...laterChapters.flatMap(([name, count], chapter) =>
          Array.from({ length: count }, (_, index) => ({
            materialId: `later-${String(chapter)}-${String(index)}`,
            slug: `later-${String(chapter)}-${String(index)}`,
            title: `${name.split(":")[0] ?? name}: урок ${String(index + 1)}`,
            availability: "available" as const,
          })),
        ),
      ],
      chapters: [
        {
          id: "progress-start",
          name: "Подготовка проекта и первый цикл разработки с агентом",
          materialIds: progressTitles.map((_, index) =>
            progressMaterialId(index),
          ),
          tasks: [
            {
              code: "progress-task",
              title: "Работа над задачей: от обсуждения до pull request",
              access: "free",
              availability: "available",
              afterMaterialId: progressMaterialId(7),
              lastSubmittedAt: "2026-10-20T10:00:00.000Z",
            },
          ],
        },
        ...laterChapters.map(([name, count], chapter) => ({
          id: `progress-later-${String(chapter)}`,
          name,
          materialIds: Array.from(
            { length: count },
            (_, index) => `later-${String(chapter)}-${String(index)}`,
          ),
          tasks: [],
        })),
      ],
    },
    current: { kind: "material", slug: "progress-8" },
  }),
);

/** Saved marks for `progressCourse`: lessons 1–8 read except lesson 4; later chapters unread. */
export const progressCourseMarks = new Map([
  ...progressTitles.map(
    (_, index) =>
      [
        progressMaterialId(index),
        { isRead: index < 8 && index !== 3, version: 1 },
      ] as const,
  ),
  ...laterChapters.flatMap(([, count], chapter) =>
    Array.from(
      { length: count },
      (_, index) =>
        [
          `later-${String(chapter)}-${String(index)}`,
          { isRead: false, version: 1 },
        ] as const,
    ),
  ),
]);
