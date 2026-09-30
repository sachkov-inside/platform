import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";

import { homeMaterialReaderReturnTarget } from "@/shared/routing/material-reader";
import {
  aiEngineeringCourseChapters,
  aiEngineeringCoursePage,
} from "@/workshop/ai-engineering-course.fixtures";
import { publicPageEnvironment } from "@/workshop/story-environment";

import { GuideProductView } from "./guide-product-view";

const environment = publicPageEnvironment("/products/ai-engineering");
const meta = {
  ...environment,
  component: GuideProductView,
  title: "Pages/Guide/AI Engineering",
  args: {
    returnTarget: homeMaterialReaderReturnTarget,
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
} satisfies Meta<typeof GuideProductView>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Desktop: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      // Метка «+ менторинг» — часть заголовка, поэтому имя начинается с названия курса.
      canvas.getByRole("heading", { level: 1, name: /^AI Engineering/u }),
    ).toBeVisible();
    // Программа и прохождение живут на своей странице: все кнопки ведут туда.
    for (const link of canvas.getAllByRole("link", {
      name: /Открыть программу/u,
    })) {
      await expect(link).toHaveAttribute(
        "href",
        "/products/ai-engineering/programme",
      );
    }
    await expect(canvas.queryByText(/Попробовать бесплатно/u)).toBeNull();
    // Анимация стоит в слоте первого экрана, описана для скринридера и идёт без кнопки паузы.
    const film = canvasElement.querySelector(".aie-hero-film");
    if (film === null) throw new Error("Missing course film slot");
    await expect(
      within(film as HTMLElement).getByRole("img"),
    ).toHaveAccessibleName(/harness/u);
    await expect(within(film as HTMLElement).queryByRole("button")).toBeNull();
  },
};

/**
 * Необязательные поля карточек и приглашение к бесплатным урокам: оформление курса показывает всё
 * написанное в описании продукта (ADR 0026).
 */
export const OptionalFields: Story = {
  args: {
    result: {
      ...meta.args.result,
      kind: "ready",
      hasNext: false,
      items: [
        {
          access: "free",
          availability: "available",
          format: "Гайд",
          seriesMemberships: [
            { name: "AI Engineering", ordinal: 1, slug: "ai-engineering" },
          ],
          slug: "course-intro",
          summary: "Как устроен курс.",
          tags: [],
          title: "Как устроен курс",
          topic: "Разработка",
          topicSlug: "development",
        },
      ],
      reference: {
        ...meta.args.result.reference,
        productPage: {
          presentation: "ai-engineering-course",
          page: {
            ...aiEngineeringCoursePage,
            blocks: [
              ...aiEngineeringCoursePage.blocks.map((block) =>
                block.kind === "cards"
                  ? {
                      ...block,
                      eyebrow: `Надзаголовок ${block.id}`,
                      note:
                        block.note === "" ? `Заметка ${block.id}` : block.note,
                      items: block.items.map((item, index) =>
                        index === 0
                          ? {
                              ...item,
                              detailLabel: "Итог",
                              detail: `Подробность ${block.id}`,
                            }
                          : item,
                      ),
                    }
                  : block,
              ),
              {
                id: "trial",
                kind: "trial" as const,
                title: "Начни с бесплатных уроков",
                text: "Первые уроки открыты всем.",
                link: "Открыть бесплатные уроки",
              },
            ],
          },
        },
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    for (const id of ["mentoring", "topics", "value", "audience", "faq"]) {
      await expect(canvas.getByText(`Надзаголовок ${id}`)).toBeInTheDocument();
      await expect(
        canvas.getByText(`Подробность ${id}`, { exact: false }),
      ).toBeInTheDocument();
    }
    for (const id of ["mentoring", "value"])
      await expect(canvas.getByText(`Заметка ${id}`)).toBeInTheDocument();
    await expect(
      canvas.getByRole("heading", { name: "Начни с бесплатных уроков" }),
    ).toBeVisible();
  },
};

export const Mobile: Story = {
  globals: { viewport: { value: "mobile390", isRotated: false } },
};
