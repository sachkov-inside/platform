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
  id: "pages-product-ai-engineering-programme",
  title: "Pages/Product/Programme/Course overview",
  args: {
    result: {
      kind: "empty",
      discoveryKind: "product",
      chapters: aiEngineeringCourseChapters,
      relatedProduct: [],
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

function chapterWindow(): HTMLDialogElement {
  const dialog = document.querySelector<HTMLDialogElement>(
    "dialog[data-chapter-window]",
  );
  if (dialog === null) throw new Error("Missing chapter window");
  return dialog;
}

/** Курс ещё не опубликован: все главы в планах, окно главы показывает её темы. */
export const Desktop: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.queryByRole("heading", {
        name: /Разработка с агентами через весь курс/u,
      }),
    ).not.toBeInTheDocument();
    await expect(
      canvasElement.querySelectorAll('[data-chapter-status="planned"]'),
    ).toHaveLength(8);
    const last = canvas.getByRole("button", {
      name: /Качество работы агентов:/u,
    });
    await expect(last).toBeVisible();
    await userEvent.click(last);
    const dialog = chapterWindow();
    await expect(dialog.open).toBe(true);
    await expect(
      within(dialog).getByRole("list", { name: /^Темы главы/u }),
    ).toBeVisible();
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Закрыть главу" }),
    );
    await expect(dialog.open).toBe(false);
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
    productMemberships: [],
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
    await expect(canvas.queryByText(/Показано .* материалов/u)).toBeNull();
    await expect(
      canvasElement.querySelectorAll('[data-chapter-status="planned"]'),
    ).toHaveLength(6);
    await expect(
      canvasElement.querySelectorAll("[data-chapter-tile]"),
    ).toHaveLength(8);
    // A chapter with lessons names its outcome in the window and keeps its topics folded.
    await userEvent.click(canvas.getByRole("button", { name: /^Глава 1/u }));
    const dialog = chapterWindow();
    const window_ = within(dialog);
    await expect(
      window_.getByText(/^Подготовишь проект к разработке с агентом/u),
    ).toBeVisible();
    const topics = dialog.querySelector(".course-chapter-content");
    if (topics === null) throw new Error("Missing chapter topics");
    await expect(topics).not.toBeVisible();
    await userEvent.click(window_.getByText("Темы и практика"));
    await expect(topics).toBeVisible();
    await expect(
      window_.getByRole("list", { name: /^Материалы главы/u }),
    ).toBeVisible();
  },
};
