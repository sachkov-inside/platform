import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";

import {
  CourseGlossaryLoading,
  CourseGlossaryView,
} from "./course-glossary-view";

const meta = {
  id: "pages-course-glossary",
  title: "Pages/Course glossary",
  component: CourseGlossaryView,
  args: {
    glossary: {
      product: {
        slug: "ddd",
        name: "Предметно-ориентированное проектирование",
      },
      terms: [
        {
          id: "aggregate",
          title: "Агрегат",
          englishTitle: "Aggregate",
          shortDefinition: "Группа объектов, которая меняется как одно целое.",
          fullDefinition:
            "Граница согласованности изменений.\n\nСнаружи к агрегату обращаются только через его корень.",
          lesson: { slug: "aggregates", title: "Агрегаты и инварианты" },
        },
        {
          id: "bounded-context",
          title: "Ограниченный контекст",
          englishTitle: "Bounded context",
          shortDefinition: "Граница, внутри которой у слов модели один смысл.",
          fullDefinition: "Часть системы со своей моделью и своим языком.",
          lesson: { slug: "ddd-intro", title: "Введение в DDD" },
        },
      ],
    },
  },
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "«Словарь курса» (#2127): термины уроков курса по алфавиту со ссылкой на урок, где термин введён. Подсказка термина в уроке ведёт сюда, к его карточке.",
      },
    },
  },
} satisfies Meta<typeof CourseGlossaryView>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Terms: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole("heading", { level: 1, name: "Словарь курса" }),
    ).toBeVisible();
    const card = canvasElement.querySelector("#term-bounded-context");
    await expect(card).not.toBeNull();
    await expect(
      canvas.getByRole("link", { name: "Введение в DDD" }),
    ).toHaveAttribute(
      "href",
      "/materials/ddd-intro?from=%2Fproducts%2Fddd%2Fprogramme",
    );
  },
};

export const Empty: Story = {
  args: {
    glossary: { product: { slug: "ddd", name: "DDD" }, terms: [] },
  },
};

export const Mobile: Story = {
  globals: { viewport: { value: "mobile320", isRotated: false } },
};

export const Loading: Story = {
  render: () => <CourseGlossaryLoading />,
};
