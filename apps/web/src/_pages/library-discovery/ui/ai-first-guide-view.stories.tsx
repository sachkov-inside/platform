import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";

import { homeMaterialReaderReturnTarget, materialReaderHref } from "@/shared/routing/material-reader";
import { aiFirstProductPage, aiFirstProductPageWithEveryField, aiFirstProductSummary } from "@/workshop/guide-page.fixtures";
import { publicPageEnvironment } from "@/workshop/story-environment";

import { GuideProductView } from "./guide-product-view";

const environment = publicPageEnvironment("/guides/working-with-agents");
const meta = {
  ...environment,
  component: GuideProductView,
  title: "Pages/Guide/AI-first",
  args: {
    returnTarget: homeMaterialReaderReturnTarget,
    result: {
      kind: "empty", discoveryKind: "series", chapters: [], relatedSeries: [], topics: [],
      reference: { name: "AI-first разработка", slug: "working-with-agents", summary: aiFirstProductSummary, productPage: { presentation: "ai-first-process", page: aiFirstProductPage } },
    },
  },
} satisfies Meta<typeof GuideProductView>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Desktop: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("heading", { name: "AI-first разработка" })).toBeVisible();
    for (const link of canvas.getAllByRole("link", { name: "Открыть программу" })) {
      await expect(link).toHaveAttribute("href", "/guides/working-with-agents/programme");
    }
  },
};
export const Mobile: Story = { globals: { viewport: { value: "mobile390", isRotated: false } } };

/**
 * Тот же продукт с оформлением `default`: общий шаблон показывает те же блоки описания простыми
 * разделами. Неизвестное оформление адаптер приводит к `default` до этой страницы, и его проверяет
 * `test/module/guide-page.test.ts`.
 */
export const DefaultTemplateShowsTheSameDescription: Story = {
  args: {
    result: {
      kind: "empty", discoveryKind: "series", chapters: [], relatedSeries: [], topics: [],
      reference: {
        name: "AI-first разработка", slug: "working-with-agents", summary: aiFirstProductSummary,
        productPage: { presentation: "default", page: aiFirstProductPage },
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("heading", { level: 2, name: "Кому это нужно" })).toBeVisible();
    await expect(canvas.getByText("Поддержка 6 месяцев")).toBeVisible();
  },
};

/** Каждое написанное поле блока видно: надзаголовок, подпись пункта и заметка раздела. */
export const EveryBlockFieldIsShown: Story = {
  args: {
    result: {
      kind: "empty", discoveryKind: "series", chapters: [], relatedSeries: [], topics: [],
      reference: {
        name: "AI-first разработка", slug: "working-with-agents", summary: aiFirstProductSummary,
        productPage: { presentation: "ai-first-process", page: aiFirstProductPageWithEveryField },
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getAllByText("Раздел продукта").length).toBeGreaterThan(0);
    await expect(canvas.getAllByText("Подпись: Значение подписи").length).toBeGreaterThan(0);
    await expect(canvas.getAllByText("Заметка раздела.").length).toBeGreaterThan(0);
  },
};

const freeLesson = {
  access: "free" as const,
  availability: "available" as const,
  format: "Гайд",
  seriesMemberships: [{ name: "AI-first разработка", ordinal: 1, slug: "working-with-agents" }],
  slug: "first-lesson",
  summary: "Первый открытый урок практикума.",
  tags: [],
  title: "С чего начать",
  topic: "Разработка",
  topicSlug: "development",
};

/** Приглашение к бесплатным урокам показывается там, где такие уроки есть. */
export const FreeEntryOpensWholeProgramme: Story = {
  args: {
    freeEntryHref: materialReaderHref("first-lesson"),
    result: {
      kind: "ready", discoveryKind: "series", chapters: [], relatedSeries: [], topics: [], items: [freeLesson], hasNext: false,
      reference: {
        name: "AI-first разработка", slug: "working-with-agents", summary: aiFirstProductSummary,
        productPage: { presentation: "ai-first-process", page: aiFirstProductPage },
      },
    },
  },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole("link", { name: "Посмотреть бесплатные уроки" })).toHaveAttribute("href", "/guides/working-with-agents/programme");
  },
};
