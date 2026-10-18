import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import type { MaterialPreview } from "@/entities/material";

import {
  aiEngineeringCourseChapters,
  aiEngineeringCoursePage,
} from "@/storybook/ai-engineering-course.fixtures";
import { publicPageEnvironment } from "@/storybook/story-environment";

import { ProductProgrammeView } from "./product-programme-view";

const environment = publicPageEnvironment("/products/ai-engineering/programme");
const meta = {
  ...environment,
  component: ProductProgrammeView,
  title: "Pages/Product/AI Engineering Programme",
  args: {
    result: {
      kind: "empty",
      discoveryKind: "series",
      chapters: aiEngineeringCourseChapters,
      relatedSeries: [],
      topics: [],
      reference: {
        name: "AI Engineering",
        slug: "ai-engineering",
        summary: "",
        productPage: {
          presentation: "ai-engineering-course",
          page: aiEngineeringCoursePage,
        },
      },
    },
  },
} satisfies Meta<typeof ProductProgrammeView>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Desktop: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.queryByRole("heading", {
        name: /Разработка с агентами через весь курс/u,
      }),
    ).not.toBeInTheDocument();
    await expect(canvas.getAllByText("Материалы готовятся")).toHaveLength(8);
    await expect(
      canvas.getByRole("heading", { name: /^Качество работы агентов:/u }),
    ).toBeVisible();
    const details = canvasElement.querySelector<HTMLDetailsElement>(
      ".course-chapter-details",
    );
    const summary = details?.querySelector("summary");
    if (details === null || summary === null || summary === undefined)
      throw new Error("Missing chapter disclosure");
    await expect(details).not.toHaveAttribute("open");
    await userEvent.click(summary);
    await expect(details).toHaveAttribute("open");
    await expect(within(details).getByRole("list")).toBeVisible();
    await userEvent.click(summary);
    await expect(details).not.toHaveAttribute("open");
  },
};

export const Mobile: Story = {
  ...Desktop,
  globals: { viewport: { value: "mobile390", isRotated: false } },
};

const lessons: readonly MaterialPreview[] = Array.from(
  { length: 15 },
  (_, index) => ({
    materialId: `course-lesson-${String(index + 1)}`,
    slug: `course-lesson-${String(index + 1)}`,
    title: `Учебный материал ${String(index + 1)}`,
    summary: "",
    access: "free",
    availability: "available",
    format: "Гайд",
    formatSlug: "guide",
    topic: "AI Engineering",
    topicSlug: "ai-engineering",
    tags: [],
    seriesMemberships: [],
  }),
);

export const WithPublishedLessons: Story = {
  args: {
    result: {
      ...meta.args.result,
      kind: "ready",
      hasNext: false,
      items: lessons,
      chapters: aiEngineeringCourseChapters.map((chapter, index) => ({
        ...chapter,
        materialIds: lessons
          .slice(index === 0 ? 0 : 8, index === 0 ? 8 : index === 1 ? 15 : 8)
          .flatMap((lesson) =>
            lesson.materialId === undefined ? [] : [lesson.materialId],
          ),
      })),
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByText("Показано 12 из 15 материалов"),
    ).toBeVisible();
    await expect(canvas.getAllByText("Материалы готовятся")).toHaveLength(6);
    await expect(
      canvas.getByRole("heading", { name: /^Качество работы агентов:/u }),
    ).toBeVisible();
    await expect(
      canvasElement.querySelectorAll(".programme-chapter"),
    ).toHaveLength(8);
    const chapters = canvasElement.querySelectorAll(".programme-chapter");
    await expect(
      chapters[0]?.querySelector(".course-chapter-outcome"),
    ).toBeNull();
    await expect(
      chapters[1]?.querySelector(".course-chapter-outcome"),
    ).toBeNull();
    await expect(
      chapters[2]?.querySelector(".course-chapter-outcome"),
    ).toBeVisible();
    await expect(
      chapters[0]?.querySelector(".course-chapter-details > summary"),
    ).toBeVisible();
  },
};
