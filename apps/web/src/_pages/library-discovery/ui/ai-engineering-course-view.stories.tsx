import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";

import type { GuideCohort } from "@/entities/subscription";
import { CohortCallView } from "@/features/ai-engineering-course";
import { homeMaterialReaderReturnTarget } from "@/shared/routing/material-reader";
import { guideWithSupportOffer } from "@/storybook/billing.fixtures";
import {
  aiEngineeringCourseChapters,
  aiEngineeringCoursePage,
} from "@/storybook/ai-engineering-course.fixtures";
import { publicPageEnvironment } from "@/storybook/story-environment";

import { cohortCall } from "../model/cohort-call";
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
    const film = canvasElement.querySelector<HTMLElement>(".aie-hero-film");
    if (film === null) throw new Error("Missing course film slot");
    await expect(within(film).getByRole("img")).toHaveAccessibleName(
      /harness/u,
    );
    await expect(within(film).queryByRole("button")).toBeNull();
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

const cohort: GuideCohort = {
  guideId: "00000000-0000-4000-8000-000000000814",
  revision: 1,
  name: "Поток 1",
  stage: "preorder",
  startsOn: "2026-10-20",
  nextEvent: "",
};

/** Предзаказ: плашка потока над кнопкой, цена — из предложения, которое видит этот человек. */
export const CohortPreorder: Story = {
  args: {
    heroCall: (
      <CohortCallView
        call={cohortCall({
          cohort,
          offer: guideWithSupportOffer,
          productAccess: "closed",
          signedIn: true,
          slug: "ai-engineering",
        })}
      />
    ),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Поток 1")).toBeVisible();
    await expect(
      canvas.getByText(/Предзаказ открыт до 20 октября/u),
    ).toBeVisible();
    await expect(
      canvas.getByRole("link", { name: /^Оплатить/u }),
    ).toHaveAttribute("href", "/products/ai-engineering/buy");
  },
};

export const CohortPreorderMobile: Story = {
  ...CohortPreorder,
  globals: { viewport: { value: "mobile390", isRotated: false } },
};

/** Анонс: денег не принимают, гость входит через Telegram и читает главу 1. */
export const CohortAnnouncement: Story = {
  args: {
    heroCall: (
      <CohortCallView
        call={cohortCall({
          cohort: { ...cohort, stage: "announcement" },
          offer: guideWithSupportOffer,
          productAccess: "closed",
          signedIn: false,
          slug: "ai-engineering",
        })}
      />
    ),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText(/Старт 20 октября/u)).toBeVisible();
    await expect(
      canvas.getByRole("button", { name: /Читать главу 1 бесплатно/u }),
    ).toBeVisible();
    await expect(canvas.queryByRole("link", { name: /^Оплатить/u })).toBeNull();
  },
};

/** Между потоками: курс открыт, плашка называет событие следующего потока. */
export const CohortBetween: Story = {
  args: {
    heroCall: (
      <CohortCallView
        call={cohortCall({
          cohort: {
            ...cohort,
            name: "Поток 2",
            stage: "between",
            startsOn: null,
            nextEvent: "эфир 15 декабря",
          },
          offer: guideWithSupportOffer,
          productAccess: "closed",
          signedIn: true,
          slug: "ai-engineering",
        })}
      />
    ),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByText(/Следующий поток: эфир 15 декабря/u),
    ).toBeVisible();
    await expect(canvas.getByRole("link", { name: "Оплатить" })).toBeVisible();
  },
};
