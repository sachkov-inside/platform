import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";

import type { ProductCohort } from "@/entities/subscription";
import {
  CohortCallView,
  CohortStatusView,
} from "@/features/ai-engineering-course";
import { homeMaterialReaderReturnTarget } from "@/shared/routing/material-reader";
import { productWithSupportOffer } from "@/storybook/billing.fixtures";
import {
  aiEngineeringCourseChapters,
  aiEngineeringCoursePage,
} from "@/storybook/ai-engineering-course.fixtures";
import { publicPageEnvironment } from "@/storybook/story-environment";

import { cohortCall } from "../model/cohort-call";
import { cohortStatus } from "../model/cohort-status";
import { ProductLandingView } from "./product-landing-view";

function fail(message: string): never {
  throw new Error(message);
}

const environment = publicPageEnvironment("/products/ai-engineering");

/**
 * Первый экран курса без потока: тот же вызов, что рисует `PendingCohortCall` маршрута, пока
 * личная часть идёт или когда поток не читается.
 */
const heroCallWithoutCohort = (
  <CohortCallView
    call={cohortCall({
      cohort: null,
      offer: null,
      productAccess: "unknown",
      signedIn: false,
      slug: "ai-engineering",
    })}
  />
);
const meta = {
  ...environment,
  component: ProductLandingView,
  title: "Pages/Product/AI Engineering",
  args: {
    heroCall: heroCallWithoutCohort,
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
} satisfies Meta<typeof ProductLandingView>;
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
      /навыки AI-инженера/u,
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

const cohort: ProductCohort = {
  productId: "00000000-0000-4000-8000-000000000814",
  revision: 1,
  name: "Поток 1",
  stage: "preorder",
  startsOn: "2026-10-20",
  nextEvent: "",
  priceAfterStartKopecks: null,
};

/** Набор на первый поток: предложение продаётся по цене предзаказа, цена после старта — у потока. */
const preorderCohort: ProductCohort = {
  ...cohort,
  startsOn: "2026-11-09",
  priceAfterStartKopecks: 3_990_000,
};
const preorderOffer = {
  ...productWithSupportOffer,
  firstPriceKopecks: 2_990_000,
};

/**
 * Предзаказ: первый экран только сообщает, что набор идёт, и ведёт к нижнему блоку. Там пункты
 * «что входит» и билет с ценой предложения, которое видит этот человек, рядом зачёркнутая цена
 * после старта и скидка к ней.
 */
export const CohortPreorder: Story = {
  parameters: { account: "authenticated" },
  args: {
    heroCall: (
      <CohortCallView
        call={cohortCall({
          cohort: preorderCohort,
          offer: preorderOffer,
          productAccess: "closed",
          signedIn: true,
          slug: "ai-engineering",
        })}
      />
    ),
    statusCall: (
      <CohortStatusView
        status={
          cohortStatus({
            cohort: preorderCohort,
            offer: preorderOffer,
            productAccess: "closed",
            slug: "ai-engineering",
          }) ?? fail("Предзаказ рисует плашку набора")
        }
      />
    ),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole("link", { name: /Идёт набор на первый поток/u }),
    ).toHaveAttribute("href", "#enroll");
    await expect(
      canvas.getByRole("link", { name: /Оформить предзаказ/u }),
    ).toHaveAttribute("href", "/products/ai-engineering/buy");
    await expect(canvas.getByText(/^−25\s%$/u)).toBeInTheDocument();
    await expect(
      canvas.getByRole("heading", { name: "Набор на первый поток" }),
    ).toBeInTheDocument();
    await expect(canvas.getAllByText("39 900 ₽").length).toBeGreaterThan(0);
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
          offer: productWithSupportOffer,
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
  parameters: { account: "authenticated" },
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
          offer: productWithSupportOffer,
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
