import { useState } from "react";
import {
  WaitlistAction,
  WaitlistMembership,
  type WaitlistState,
} from "@/features/product-waitlist";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";

import {
  StartCountdownBadge,
  type ProductSalesState,
} from "@/entities/subscription";
import {
  CohortCallView,
  CourseLearningLink,
  CohortStatusView,
} from "@/features/ai-engineering-course";
import { homeMaterialReaderReturnTarget } from "@/shared/routing/material-reader";
import { productWithSupportOffer } from "@/storybook/billing.fixtures";
import {
  aiEngineeringPublishedTopics,
  aiEngineeringCourseChapters,
  aiEngineeringCoursePage,
} from "@/storybook/ai-engineering-course.fixtures";
import { publicPageEnvironment } from "@/storybook/story-environment";

import { cohortCall } from "../model/cohort-call";
import { cohortStatus } from "../model/cohort-status";
import { LearnerCourseStatus } from "./ai-engineering-course-view";
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
  id: "pages-product-ai-engineering",
  title: "Pages/Product/Landing/AI Engineering",
  args: {
    heroCall: heroCallWithoutCohort,
    returnTarget: homeMaterialReaderReturnTarget,
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
 * Позиция, «Что изучим» и процесс с контролем над агентом (#1909): каждая тема получает свою
 * иллюстрацию по названию, окно проекта переключает файлы кликом и стрелками.
 */
export const PositionTopicsAndProcess: Story = {
  play: async ({ canvasElement, userEvent: user }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole("heading", {
        name: "Код пишет агент. Что остаётся тебе?",
      }),
    ).toBeVisible();
    const tiles = canvasElement.querySelectorAll(".aie-bento > li");
    await expect(tiles.length).toBe(15);
    for (const tile of tiles)
      await expect(tile.querySelector(".aie-bento-art")).not.toBeNull();

    const files = canvas.getByRole("tablist", { name: "Файлы проекта" });
    const panel = canvas.getByRole("tabpanel");
    await expect(within(panel).getByText("AGENTS.md")).toBeVisible();
    await user.click(
      within(files).getByRole("tab", { name: /Словарь домена/u }),
    );
    await expect(within(panel).getByText(/Обращение/u)).toBeVisible();
    await user.keyboard("{ArrowDown}");
    await expect(
      within(files).getByRole("tab", { name: /Архитектурное решение/u }),
    ).toHaveAttribute("aria-selected", "true");
    await expect(within(panel).getByText(/своя схема БД/u)).toBeVisible();
    await user.keyboard("{End}");
    await expect(
      within(files).getByRole("tab", { name: /Проверка архитектуры/u }),
    ).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{Home}");
    await expect(
      within(files).getByRole("tab", { name: /Инструкции/u }),
    ).toHaveFocus();
  },
};

/**
 * Описание, опубликованное до лендинга #1909: темы сохраняют свои иллюстрации, пока текст в Inside
 * Content не обновлён, а блок с незнакомым `id` рисуется по своему виду.
 */
export const PublishedDescription: Story = {
  args: {
    result: {
      ...meta.args.result,
      reference: {
        ...meta.args.result.reference,
        productPage: {
          presentation: "ai-engineering-course",
          page: {
            ...aiEngineeringCoursePage,
            blocks: [
              ...aiEngineeringCoursePage.blocks.filter(
                (block) => block.id === "hero",
              ),
              {
                id: "topics",
                kind: "cards" as const,
                eyebrow: "",
                title: "Что изучим",
                lead: "",
                note: "",
                items: aiEngineeringPublishedTopics.map((title) => ({
                  title,
                  text: `Описание темы «${title}».`,
                  detailLabel: "",
                  detail: "",
                })),
              },
              {
                id: "unknown-block",
                kind: "cards" as const,
                eyebrow: "",
                title: "Незнакомый блок",
                lead: "",
                note: "",
                items: [
                  {
                    title: "Пункт",
                    text: "Рисуется общим видом карточек.",
                    detailLabel: "",
                    detail: "",
                  },
                ],
              },
            ],
          },
        },
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const tiles = canvasElement.querySelectorAll(".aie-bento > li");
    await expect(tiles.length).toBe(aiEngineeringPublishedTopics.length);
    for (const tile of tiles)
      await expect(tile.querySelector(".aie-bento-art")).not.toBeNull();
    await expect(
      canvas.getByRole("heading", { name: "Незнакомый блок" }),
    ).toBeVisible();
    await expect(
      canvas.getByText("Рисуется общим видом карточек."),
    ).toBeVisible();
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
          productMemberships: [
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
    for (const id of [
      "position",
      "topics",
      "mentoring",
      "value",
      "process",
      "audience",
      "faq",
    ]) {
      await expect(canvas.getByText(`Надзаголовок ${id}`)).toBeInTheDocument();
      await expect(
        canvas.getByText(`Подробность ${id}`, { exact: false }),
      ).toBeInTheDocument();
    }
    for (const id of ["position", "mentoring", "value", "process"])
      await expect(canvas.getByText(`Заметка ${id}`)).toBeInTheDocument();
    await expect(
      canvas.getByRole("heading", { name: "Начни с бесплатных уроков" }),
    ).toBeVisible();
  },
};

export const Mobile: Story = {
  globals: { viewport: { value: "mobile390", isRotated: false } },
  play: async ({ canvasElement }) => {
    await expect(
      canvasElement.querySelector('nav[aria-label="Навигация курса"]'),
    ).toBeNull();
  },
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

const cohort: ProductSalesState = {
  productId: "00000000-0000-4000-8000-000000000814",
  revision: 1,
  name: "Поток 1",
  stage: "preorder",
  startsOn: "2026-10-20",
  nextEvent: "",
  priceAfterStartKopecks: null,
};

/** Набор на первый поток: предложение продаётся по цене предзаказа, цена после старта — у потока. */
const preorderCohort: ProductSalesState = {
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

/** Действие внутри тёмного блока, ниже сцены: панели анимации остаются открыты. */
async function expectFilmActionPlacement(film: HTMLElement) {
  const scene = film.querySelector(".aie-film") ?? fail("Сцена анимации");
  const link =
    film.querySelector(".aie-learning-link") ?? fail("Действие обучения");
  const frame = film.getBoundingClientRect();
  const sceneBounds = scene.getBoundingClientRect();
  const actionBounds = link.getBoundingClientRect();
  await expect(actionBounds.top).toBeGreaterThanOrEqual(sceneBounds.bottom);
  await expect(actionBounds.bottom).toBeLessThan(frame.bottom);
  await expect(actionBounds.left).toBeGreaterThan(frame.left);
  await expect(actionBounds.right).toBeLessThan(frame.right);
}

/** Участник продолжает обучение с анимации; нижний блок «что входит» ему не нужен. */
async function expectParticipantActions(canvasElement: HTMLElement) {
  const film =
    canvasElement.querySelector<HTMLElement>(".aie-hero-film") ??
    fail("Анимация курса");
  await expect(
    within(film).getByRole("link", { name: "Продолжить обучение" }),
  ).toHaveAttribute("href", "/products/ai-engineering/programme");
  await expectFilmActionPlacement(film);
  const status =
    canvasElement.querySelector<HTMLElement>(".aie-status") ??
    fail("Нижний блок");
  await expect(status).not.toBeVisible();
}

export const CourseParticipant: Story = {
  parameters: { account: "authenticated" },
  args: {
    heroBadge: (
      <>
        <StartCountdownBadge text="до старта 10 дней" />
        <CourseLearningLink slug="ai-engineering" />
      </>
    ),
    statusCall: <LearnerCourseStatus />,
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
    await expectParticipantActions(canvasElement);
  },
};
export const CourseParticipantContinuing: Story = {
  ...CourseParticipant,
  args: {
    ...CourseParticipant.args,
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
      within(hero).getAllByRole("link", { name: "Продолжить обучение" }),
    ).toHaveLength(2);
    await expectParticipantActions(canvasElement);
  },
};
export const CourseParticipantContinuingMobile: Story = {
  ...CourseParticipantContinuing,
  globals: { viewport: { value: "mobile390", isRotated: false } },
};

export const CourseParticipantResolving: Story = {
  ...CourseParticipant,
  render: function ResolvingParticipant(args) {
    const [resolved, setResolved] = useState(false);
    return (
      <>
        <button
          type="button"
          onClick={() => {
            setResolved(true);
          }}
        >
          Завершить проверку доступа
        </button>
        <ProductLandingView
          {...args}
          statusCall={resolved ? args.statusCall : null}
        />
      </>
    );
  },
  play: async ({ canvasElement }) => {
    const status =
      canvasElement.querySelector<HTMLElement>(".aie-status") ??
      fail("Нижний блок");
    await expect(
      within(status).getByText("Бессрочный доступ к курсу"),
    ).toBeVisible();
    await userEvent.click(
      within(canvasElement).getByRole("button", {
        name: "Завершить проверку доступа",
      }),
    );
    await expectParticipantActions(canvasElement);
  },
};

export const CourseParticipantResolvingMobile: Story = {
  ...CourseParticipantResolving,
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
/** Между потоками продажа открыта: метка набора на первом экране и билет доступа внизу. */
const betweenCohort: ProductSalesState = {
  ...cohort,
  name: "Поток 2",
  stage: "between",
  startsOn: null,
  nextEvent: "эфир 15 декабря",
};
export const CohortBetween: Story = {
  parameters: { account: "authenticated" },
  args: {
    heroCall: (
      <CohortCallView
        call={cohortCall({
          cohort: betweenCohort,
          offer: productWithSupportOffer,
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
            cohort: betweenCohort,
            offer: productWithSupportOffer,
            productAccess: "closed",
            slug: "ai-engineering",
          }) ?? fail("Между потоками с продажей рисуется билет")
        }
      />
    ),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole("link", { name: /Идёт набор на курс/u }),
    ).toHaveAttribute("href", "#enroll");
    await expect(
      canvas.getByText(/Следующий поток: эфир 15 декабря/u),
    ).toBeVisible();
    const ticket = within(
      canvasElement.querySelector<HTMLElement>(".aie-cohort-ticket") ??
        fail("Билет нижнего блока"),
    );
    await expect(
      ticket.getByRole("link", { name: /Приобрести доступ/u }),
    ).toHaveAttribute("href", "/products/ai-engineering/buy");
    await expect(
      ticket.getByRole("link", { name: "Открыть программу" }),
    ).toBeVisible();
  },
};

/** Анимация первого экрана зовёт того, кто ещё не учится, попробовать бесплатно (#1647). */
const freeStartBadge = (countdown: string | null) => (
  <>
    <CourseLearningLink intent="try-free" slug="ai-engineering" />
    {countdown === null ? null : <StartCountdownBadge text={countdown} />}
  </>
);
async function expectFreeStart(
  canvasElement: HTMLElement,
  ticketLabel: string,
) {
  const film =
    canvasElement.querySelector<HTMLElement>(".aie-hero-film") ??
    fail("Анимация курса");
  await expect(
    within(film).getByRole("link", { name: "Попробовать бесплатно" }),
  ).toHaveAttribute("href", "/products/ai-engineering/programme");
  await expectFilmActionPlacement(film);
  const ticket =
    canvasElement.querySelector<HTMLElement>(".aie-cohort-ticket") ??
    fail("Билет нижнего блока");
  await expect(
    within(ticket).getByRole("link", { name: "Попробовать бесплатно" }),
  ).toHaveAttribute("href", "/products/ai-engineering/programme");
  await expect(within(ticket).getByText(ticketLabel)).toBeVisible();
  await expect(canvasElement.scrollWidth).toBe(canvasElement.clientWidth);
}

/**
 * Как сейчас на production до открытия продаж: список ожидания на первом экране и в билете, на
 * анимации и в билете «Попробовать бесплатно» (#1647).
 */
export const FreeStartWaitlist: Story = {
  args: {
    heroCall: (
      <WaitlistAction
        state="idle"
        onBegin={() => undefined}
        onWithdraw={() => undefined}
        linking={null}
      />
    ),
    heroBadge: freeStartBadge("до старта 7 дней"),
    statusCall: (
      <WaitlistAction
        lower
        productSlug="ai-engineering"
        programmeLabel="Попробовать бесплатно"
        state="idle"
        onBegin={() => undefined}
        onWithdraw={() => undefined}
        linking={null}
      />
    ),
  },
  play: async ({ canvasElement }) => {
    await expectFreeStart(canvasElement, "Скоро начнётся");
  },
};
export const FreeStartWaitlistMobile: Story = {
  ...FreeStartWaitlist,
  globals: { viewport: { value: "mobile390", isRotated: false } },
};

/** Анонс без продажи: на первом экране в программу ведёт только «Попробовать бесплатно» (#1647). */
export const FreeStartAnnouncement: Story = {
  args: {
    heroCall: (
      <CohortCallView
        call={cohortCall({
          cohort: { ...preorderCohort, stage: "announcement" },
          offer: null,
          productAccess: "closed",
          signedIn: false,
          slug: "ai-engineering",
          freeStart: true,
        })}
      />
    ),
    heroBadge: freeStartBadge("до старта 31 день"),
  },
  play: async ({ canvasElement }) => {
    const hero =
      canvasElement.querySelector<HTMLElement>(".aie-hero") ??
      fail("Первый экран курса");
    const links = within(hero).getAllByRole("link");
    await expect(links.map((link) => link.textContent)).toEqual([
      "Попробовать бесплатно",
    ]);
  },
};

export const FreeStartAnnouncementMobile: Story = {
  ...FreeStartAnnouncement,
  globals: { viewport: { value: "mobile390", isRotated: false } },
};

/** Предзаказ открыт: в билете цена со скидкой, «Оформить предзаказ» и «Попробовать бесплатно». */
export const FreeStartPreorder: Story = {
  parameters: { account: "authenticated" },
  args: {
    ...CohortPreorder.args,
    heroBadge: freeStartBadge("до старта 31 день"),
    statusCall: (
      <CohortStatusView
        status={
          cohortStatus({
            cohort: preorderCohort,
            offer: preorderOffer,
            productAccess: "closed",
            slug: "ai-engineering",
            freeStart: true,
            today: "2026-10-09",
          }) ?? fail("Предзаказ рисует билет")
        }
      />
    ),
  },
  play: async ({ canvasElement }) => {
    await expectFreeStart(canvasElement, "Предзаказ");
    await expect(
      within(canvasElement).getByRole("link", { name: /Оформить предзаказ/u }),
    ).toHaveAttribute("href", "/products/ai-engineering/buy");
  },
};

/**
 * Продажи открыты, поток идёт: билет продаёт доступ по цене предложения, рядом приглашение
 * попробовать бесплатно (решение владельца 29.10.2026, #1647).
 */
const runningCohort: ProductSalesState = {
  ...preorderCohort,
  stage: "running",
  startsOn: "2026-10-20",
};
export const FreeStartSale: Story = {
  parameters: { account: "authenticated" },
  args: {
    heroCall: (
      <CohortCallView
        call={cohortCall({
          cohort: runningCohort,
          offer: preorderOffer,
          productAccess: "closed",
          signedIn: true,
          slug: "ai-engineering",
        })}
      />
    ),
    heroBadge: freeStartBadge(null),
    statusCall: (
      <CohortStatusView
        status={
          cohortStatus({
            cohort: runningCohort,
            offer: preorderOffer,
            productAccess: "closed",
            slug: "ai-engineering",
            freeStart: true,
            today: "2026-10-29",
          }) ?? fail("Идущий поток с продажей рисует билет")
        }
      />
    ),
  },
  play: async ({ canvasElement }) => {
    await expectFreeStart(canvasElement, "Доступ к курсу");
    // Первый экран цену не показывает: метка набора ведёт к билету (решение владельца 29.10.2026).
    const hero =
      canvasElement.querySelector<HTMLElement>(".aie-hero") ??
      fail("Первый экран курса");
    await expect(
      within(hero).getByRole("link", { name: /Идёт набор на курс/u }),
    ).toHaveAttribute("href", "#enroll");
    await expect(within(hero).queryByText(/₽/u)).toBeNull();
    const ticket =
      canvasElement.querySelector<HTMLElement>(".aie-cohort-ticket") ??
      fail("Билет нижнего блока");
    await expect(
      within(ticket).getByRole("link", { name: /Приобрести доступ/u }),
    ).toHaveAttribute("href", "/products/ai-engineering/buy");
    await expect(within(ticket).getByText(/29\s900\s₽/u)).toBeVisible();
  },
};
export const FreeStartSaleMobile: Story = {
  ...FreeStartSale,
  globals: { viewport: { value: "mobile390", isRotated: false } },
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
    const page = within(canvasElement);
    for (const button of page.getAllByRole("button", {
      name: "Вы в списке ожидания",
    }))
      await expect(button).toBeDisabled();
    await expect(page.queryByText("Отказаться от ожидания")).toBeNull();
    await expect(
      page.queryByText("Сообщу об открытии набора в Telegram."),
    ).toBeNull();
  },
};
export const WaitlistJoin: Story = {
  render: () => <WaitlistCourseFixture />,
  play: async ({ canvasElement, userEvent }) => {
    const page = within(canvasElement);
    await userEvent.click(
      page.getAllByRole("button", { name: "Вступить в список ожидания" })[0] ??
        fail("Запись"),
    );
    await expect(
      page.getAllByRole("button", { name: "Вы в списке ожидания" }),
    ).toHaveLength(2);
    await expect(
      page.queryByRole("button", { name: "Вступить в список ожидания" }),
    ).toBeNull();
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
      notice={state === "idle" ? "Вы вышли из списка ожидания." : ""}
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
          {learning ? null : membership}
        </>
      }
      statusCall={
        learning ? (
          <LearnerCourseStatus />
        ) : (
          <>
            {status === null ? null : <CohortStatusView status={status} />}
            {membership}
          </>
        )
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
      page.getAllByRole("button", { name: "Вы в списке ожидания" }),
    ).toHaveLength(2);
    await expect(
      page.getByRole("link", { name: "Оформить предзаказ" }),
    ).toBeVisible();
    await expect(page.queryByText("Отказаться от ожидания")).toBeNull();
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
      page.queryByRole("button", { name: /список ожидания/u }),
    ).toBeNull();
    await expect(page.queryByText("Отказаться от ожидания")).toBeNull();
    await expect(
      canvasElement.querySelector<HTMLElement>(".aie-status") ??
        fail("Нижний блок"),
    ).not.toBeVisible();
  },
};
