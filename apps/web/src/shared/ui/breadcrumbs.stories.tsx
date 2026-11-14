import { productPath } from "@/shared/routing/public-page-path";
import {
  productProgrammeHref,
  productTaskHref,
} from "@/shared/routing/subscription-route";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { publicPageEnvironment } from "@/storybook/story-environment";
import { Breadcrumbs } from "./breadcrumbs";

const meta = {
  ...publicPageEnvironment("/materials/brief"),
  id: "shared-breadcrumbs",
  title: "Components/Navigation/Breadcrumbs",
  component: Breadcrumbs,
  args: {
    items: [
      { label: "AI Engineering", href: productPath("ai-engineering") },
      {
        label: "Глава 1",
        fullLabel: "Подготовь проект к разработке",
        href: productProgrammeHref("ai-engineering"),
      },
      {
        label: "Задание",
        fullLabel: "Подготовь проект к работе с агентом",
        href: productTaskHref("ai-engineering", "aie-ch1-harness"),
        restoreOrigin: true,
      },
      { label: "Бриф заказчика" },
    ],
  },
} satisfies Meta<typeof Breadcrumbs>;
export default meta;
type Story = StoryObj<typeof meta>;
export const CourseLocation: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const nav = canvas.getByRole("navigation", { name: "Хлебные крошки" });
    await expect(within(nav).getAllByRole("link")).toHaveLength(3);
    await expect(nav.querySelector('[aria-current="page"]')).toHaveTextContent(
      "Бриф заказчика",
    );
    await expect(canvasElement.ownerDocument.documentElement.scrollWidth).toBe(
      canvasElement.ownerDocument.documentElement.clientWidth,
    );
  },
};
export const Mobile: Story = {
  ...CourseLocation,
  globals: { viewport: { value: "mobile390", isRotated: false } },
};
export const LongTitles: Story = {
  args: {
    items: [
      { label: "AI Engineering", href: productPath("ai-engineering") },
      { label: "Глава 1", href: productProgrammeHref("ai-engineering") },
      { label: "Как устроен пайплайн разработки с агентом" },
    ],
  },
  play: async ({ canvasElement }) => {
    const current = canvasElement.querySelector<HTMLElement>(
      '[aria-current="page"]',
    );
    if (current === null) throw new Error("Current breadcrumb is missing");
    await expect(current).toHaveAttribute(
      "title",
      "Как устроен пайплайн разработки с агентом",
    );
    await expect(current.scrollWidth).toBeGreaterThan(current.clientWidth);
    await expect(getComputedStyle(current).textOverflow).toBe("ellipsis");
  },
};
export const LongTitlesMobile: Story = {
  ...LongTitles,
  globals: { viewport: { value: "mobile390", isRotated: false } },
};

/**
 * На телефоне компактные крошки урока показывают курс и текущий урок, а середину сворачивают в
 * многоточие: читатель видит, где он, и не теряет название урока.
 */
export const CompactLessonMobile: Story = {
  args: {
    compact: true,
    items: [
      {
        label: "Демо: интерактивные уроки",
        href: productPath("ai-engineering"),
      },
      {
        label: "Глава 1",
        fullLabel: "Подготовь проект к разработке",
        href: productProgrammeHref("ai-engineering"),
      },
      { label: "Витрина: как выглядит материал" },
    ],
  },
  globals: { viewport: { value: "mobile390", isRotated: false } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const nav = canvas.getByRole("navigation", { name: "Хлебные крошки" });
    const course = within(nav).getByRole("link", {
      name: "Демо: интерактивные уроки",
    });
    const current = nav.querySelector<HTMLElement>('[aria-current="page"]');
    if (current === null) throw new Error("Current breadcrumb is missing");
    await expect(course).toBeVisible();
    await expect(current).toBeVisible();
    await expect(current).toHaveTextContent("Витрина: как выглядит материал");
    // The course keeps enough room to be recognised; the lesson takes the rest.
    await expect(course.getBoundingClientRect().width).toBeGreaterThan(80);
    await expect(current.getBoundingClientRect().width).toBeGreaterThan(120);
    // The chapter stays reachable for assistive technology but folds into an ellipsis.
    const chapter = within(nav).getByRole("link", {
      name: "Подготовь проект к разработке",
    });
    await expect(chapter.getBoundingClientRect().width).toBeLessThanOrEqual(1);
    await expect(within(nav).getByText("…")).toBeVisible();
    const box = nav.getBoundingClientRect();
    await expect(current.getBoundingClientRect().top - box.top).toBeLessThan(
      24,
    );
    await expect(canvasElement.ownerDocument.documentElement.scrollWidth).toBe(
      canvasElement.ownerDocument.documentElement.clientWidth,
    );
  },
};

/** На широком экране компактные крошки показывают весь путь без многоточия. */
export const CompactLessonDesktop: Story = {
  ...CompactLessonMobile,
  globals: { viewport: { value: "desktop1440", isRotated: false } },
  play: async ({ canvasElement }) => {
    const nav = within(canvasElement).getByRole("navigation", {
      name: "Хлебные крошки",
    });
    await expect(within(nav).getAllByRole("link")).toHaveLength(2);
    for (const link of within(nav).getAllByRole("link"))
      await expect(link).toBeVisible();
    await expect(within(nav).queryByText("…")).not.toBeVisible();
  },
};
