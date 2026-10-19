import { useState } from "react";
import {
  WaitlistAction,
  WaitlistMembership,
  type WaitlistState,
} from "@/features/product-waitlist";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";

import {
  StartCountdownBadge,
  type ProductCohort,
} from "@/entities/subscription";
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
    await expect(
      canvas.queryByRole("heading", { name: "Программа курса" }),
    ).toBeNull();
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

/** Планшет: темы идут по порядку, по две равные карточки в каждом ряду. */
export const Tablet: Story = {
  parameters: {
    viewport: {
      options: {
        tablet923: {
          name: "Tablet 923 × 1512",
          styles: { width: "923px", height: "1512px" },
          type: "tablet",
        },
      },
    },
  },
  globals: { viewport: { value: "tablet923", isRotated: false } },
  play: async ({ canvasElement }) => {
    const cards = Array.from(
      canvasElement.querySelectorAll<HTMLElement>(".aie-bento > li"),
    );
    const first = cards[0] ?? fail("Блок тем курса должен содержать карточки");
    await expect(cards.length).toBeGreaterThan(1);
    for (const [index, card] of cards.entries()) {
      await expect(
        Math.abs(
          card.getBoundingClientRect().width -
            first.getBoundingClientRect().width,
        ),
      ).toBeLessThan(1);
      const previous = cards[index - 1];
      if (index % 2 === 1 && previous !== undefined) {
        await expect(card.offsetTop).toBe(previous.offsetTop);
        await expect(card.offsetLeft).toBeGreaterThan(previous.offsetLeft);
      }
    }
  },
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
    heroBadge: <StartCountdownBadge text="до старта 31 день" />,
    statusCall: (
      <CohortStatusView
        status={
          cohortStatus({
            cohort: preorderCohort,
            offer: preorderOffer,
            productAccess: "closed",
            slug: "ai-engineering",
            today: "2026-10-09",
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
    // Сколько дней до старта, видно дважды: наклейкой на анимации и над заголовком блока набора.
    await expect(canvas.getAllByText("до старта 31 день")).toHaveLength(2);
    // Первый экран в программу не уводит: туда ведёт кнопка под темами курса.
    const hero =
      canvasElement.querySelector<HTMLElement>(".aie-hero") ??
      fail("Первый экран курса");
    await expect(
      within(hero).queryByRole("link", { name: /Открыть программу/u }),
    ).toBeNull();
    const topics =
      canvasElement.querySelector<HTMLElement>(".aie-topics") ??
      fail("Блок тем курса");
    // На телефоне эта кнопка скрыта: в программу там ведёт нижняя панель.
    await expect(
      topics.querySelector("a.aie-topics-programme"),
    ).toHaveAttribute("href", "/products/ai-engineering/programme");
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

export const CourseParticipant: Story = {
  parameters: { account: "authenticated" },
  args: {
    heroCall: (
      <CohortCallView
        call={cohortCall({
          cohort: preorderCohort,
          offer: preorderOffer,
          productAccess: "open",
          signedIn: true,
          slug: "ai-engineering",
        })}
      />
    ),
  },
  play: async ({ canvasElement }) => {
    const hero =
      canvasElement.querySelector<HTMLElement>(".aie-hero") ??
      fail("Первый экран курса");
    await expect(
      within(hero).getByRole("link", { name: "Открыть программу" }),
    ).toHaveAttribute("href", "/products/ai-engineering/programme");
    await expect(
      within(hero).queryByText("Идёт набор на первый поток"),
    ).toBeNull();
  },
};
export const CourseParticipantContinuing: Story = {
  ...CourseParticipant,
  args: {
    heroCall: (
      <CohortCallView
        call={cohortCall({
          cohort: preorderCohort,
          offer: preorderOffer,
          productAccess: "open",
          signedIn: true,
          slug: "ai-engineering",
          continuationMaterialSlug: "course-intro",
        })}
      />
    ),
  },
  play: async ({ canvasElement }) => {
    const hero =
      canvasElement.querySelector<HTMLElement>(".aie-hero") ??
      fail("Первый экран курса");
    await expect(
      within(hero).getByRole("link", { name: "Продолжить обучение" }),
    ).toHaveAttribute("href", "/products/ai-engineering/programme");
  },
};
export const CourseParticipantContinuingMobile: Story = {
  ...CourseParticipantContinuing,
  globals: { viewport: { value: "mobile390", isRotated: false } },
};

/** Анонс: тёмная кнопка ведёт в программу, обещания бесплатных глав нет. */
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
    await expect(canvas.queryByText(/Старт 20 октября/u)).toBeNull();
    const hero =
      canvasElement.querySelector<HTMLElement>(".aie-hero") ??
      fail("Первый экран курса");
    await expect(
      within(hero).getByRole("link", { name: "Открыть программу" }),
    ).toHaveAttribute("href", "/products/ai-engineering/programme");
    await expect(
      canvas.queryByRole("button", { name: /^Оплатить/u }),
    ).toBeNull();
    await expect(canvas.queryByText(/главу бесплатно/u)).toBeNull();
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

function WaitlistCourseFixture({
  initialState = "idle",
}: {
  readonly initialState?: WaitlistState;
}) {
  const [state, setState] = useState(initialState);
  const action = (lower: boolean) => (
    <WaitlistAction
      lower={lower}
      state={state}
      onBegin={() => {
        setState("success");
      }}
      onWithdraw={() => {
        setState("idle");
      }}
      linking={
        <button
          type="button"
          onClick={() => {
            setState("success");
          }}
        >
          Подключить Telegram
        </button>
      }
    />
  );
  return (
    <ProductLandingView
      {...meta.args}
      heroCall={action(false)}
      statusCall={action(true)}
    />
  );
}
export const WaitlistGuest: Story = {
  render: () => <WaitlistCourseFixture />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getAllByRole("button", { name: "Вступить в список ожидания" }),
    ).toHaveLength(2);
    const hero = canvasElement.querySelector('[data-product-part="hero"]');
    if (!(hero instanceof HTMLElement)) throw new Error("Hero required");
    await expect(
      within(hero).queryByText("Программа и бесплатные материалы"),
    ).toBeNull();
  },
};
export const WaitlistConfirmed: Story = {
  render: () => <WaitlistCourseFixture initialState="success" />,
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getAllByRole("button", {
        name: "Отказаться от ожидания",
      }),
    ).toHaveLength(2);
  },
};
export const WaitlistSaving: Story = {
  render: () => <WaitlistCourseFixture initialState="saving" />,
  play: async ({ canvasElement }) => {
    for (const button of within(canvasElement).getAllByRole("button", {
      name: /Сохраняю/u,
    }))
      await expect(button).toBeDisabled();
  },
};
export const WaitlistError: Story = {
  render: () => <WaitlistCourseFixture initialState="error" />,
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getAllByRole("alert")).toHaveLength(2);
  },
};
export const WaitlistTelegramLink: Story = {
  render: () => <WaitlistCourseFixture initialState="linking" />,
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getAllByRole("button", {
        name: "Подключить Telegram",
      }),
    ).toHaveLength(2);
  },
};
export const WaitlistExpired: Story = {
  render: () => <WaitlistCourseFixture initialState="expired" />,
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getAllByRole("alert")).toHaveLength(2);
  },
};

function ExistingWaitlistCourseFixture({
  learning = false,
  initialState = "success",
}: {
  readonly learning?: boolean;
  readonly initialState?: WaitlistState;
}) {
  const [state, setState] = useState(initialState);
  const membership = (
    <WaitlistMembership
      state={state}
      notice={state === "idle" ? "Вы отказались от ожидания." : ""}
      onBegin={() => {
        setState("success");
      }}
      onWithdraw={() => {
        setState("idle");
      }}
      retryingWithdrawal={state === "error"}
    />
  );
  const call = cohortCall({
    cohort: preorderCohort,
    offer: preorderOffer,
    productAccess: learning ? "open" : "closed",
    signedIn: true,
    slug: "ai-engineering",
    continuationMaterialSlug: learning ? "course-intro" : null,
  });
  const status = learning
    ? null
    : cohortStatus({
        cohort: preorderCohort,
        offer: preorderOffer,
        productAccess: "closed",
        slug: "ai-engineering",
      });
  return (
    <ProductLandingView
      {...meta.args}
      heroCall={
        <>
          <CohortCallView call={call} />
          {membership}
        </>
      }
      statusCall={
        <>
          {status === null ? null : <CohortStatusView status={status} />}
          {membership}
        </>
      }
    />
  );
}
export const WaitlistExistingWithOffer: Story = {
  parameters: { account: "authenticated" },
  render: () => <ExistingWaitlistCourseFixture />,
  play: async ({ canvasElement }) => {
    const page = within(canvasElement);
    await expect(
      page.getAllByRole("button", { name: "Отказаться от ожидания" }),
    ).toHaveLength(2);
    await expect(
      page.getByRole("link", { name: "Оформить предзаказ" }),
    ).toBeVisible();
    await expect(
      page.queryByRole("button", { name: "Вступить в список ожидания" }),
    ).toBeNull();
  },
};
export const WaitlistExistingWithOfferWithdrawal: Story = {
  ...WaitlistExistingWithOffer,
  play: async ({ canvasElement, userEvent }) => {
    const page = within(canvasElement);
    const withdraw =
      page.getAllByRole("button", { name: "Отказаться от ожидания" })[0] ??
      fail("Отказ");
    await userEvent.click(withdraw);
    await expect(
      page.queryByRole("button", { name: "Отказаться от ожидания" }),
    ).toBeNull();
    await expect(
      page.queryByRole("button", { name: "Вступить в список ожидания" }),
    ).toBeNull();
    await expect(
      page.getByRole("link", { name: "Оформить предзаказ" }),
    ).toBeVisible();
  },
};
export const WaitlistExistingWithLearning: Story = {
  parameters: { account: "authenticated" },
  render: () => <ExistingWaitlistCourseFixture learning />,
  play: async ({ canvasElement }) => {
    const page = within(canvasElement);
    await expect(
      page.getByRole("link", { name: "Продолжить обучение" }),
    ).toBeVisible();
    await expect(
      page.getAllByRole("button", { name: "Отказаться от ожидания" }),
    ).toHaveLength(2);
    await expect(
      page.queryByRole("button", { name: "Вступить в список ожидания" }),
    ).toBeNull();
  },
};
export const WaitlistContinuingWithLearning: Story = {
  parameters: { account: "authenticated" },
  render: () => (
    <ExistingWaitlistCourseFixture learning initialState="saving" />
  ),
};
export const WaitlistWithdrawalRetryWithLearning: Story = {
  parameters: { account: "authenticated" },
  render: () => <ExistingWaitlistCourseFixture learning initialState="error" />,
  play: async ({ canvasElement }) => {
    const page = within(canvasElement);
    await expect(page.getAllByRole("alert")).toHaveLength(2);
    await expect(
      page.getAllByRole("button", { name: "Повторить отказ" }),
    ).toHaveLength(2);
    await expect(
      page.getByRole("link", { name: "Продолжить обучение" }),
    ).toBeVisible();
  },
};
