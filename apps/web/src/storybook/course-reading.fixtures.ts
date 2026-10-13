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
      materialId: "first-id",
      slug: "first",
      title: "Первый урок",
      availability: "available" as const,
    },
    {
      materialId: "course-intro-id",
      slug: "course-intro",
      title: "Как устроен курс",
      availability: "available" as const,
    },
    {
      materialId: "next-id",
      slug: "next",
      title: "Следующий урок",
      availability: "locked" as const,
    },
  ],
  chapters: [
    {
      id: "start",
      name: "Подготовь проект к разработке с агентом и проверь настройку",
      materialIds: ["first-id", "course-intro-id"],
      tasks: [
        {
          code: "aie-ch1-onboarding",
          title: "Онбординг нового разработчика за час",
          access: "closed" as const,
          availability: "available" as const,
          afterMaterialId: "course-intro-id",
          lastSubmittedAt: null,
        },
      ],
    },
    {
      id: "continue",
      name: "Продолжение",
      materialIds: ["next-id"],
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
    series: courseSource,
    current: { kind: "material", slug: "course-intro" },
  }),
);
export const courseTask = requiredContext(
  courseReadingContext({
    series: courseSource,
    current: { kind: "task", code: "aie-ch1-onboarding" },
  }),
);
export const taskOnlyCourse = requiredContext(
  courseReadingContext({
    series: {
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
    series: courseSource,
    current: { kind: "material", slug: "next" },
  }),
);
