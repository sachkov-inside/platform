import type { Meta, StoryObj } from "@storybook/react-vite";
import { Suspense, use } from "react";
import { expect, within } from "storybook/test";

import {
  boxOf,
  desktop,
  mobile,
  originOf,
  settleStoryFrame,
  stagedLoaders,
  stagedLoadingOf,
  type StagedLoading,
  type StoryViewport,
} from "@/storybook/loads-in-place";
import {
  publicPageEnvironment,
  routeContent,
} from "@/storybook/story-environment";

import type { CourseGlossary } from "../model/course-glossary";
import {
  CourseGlossaryLoading,
  CourseGlossaryView,
} from "./course-glossary-view";

const environment = publicPageEnvironment("/products/ddd/glossary");
const meta = {
  ...environment,
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
    ...environment.parameters,
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
    const canvas = routeContent(canvasElement);
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

/** `loading.tsx`: скелет в той же рамке, что и словарь. */
export const Loading: Story = {
  render: () => <CourseGlossaryLoading />,
};

/** Вся страница личная: под скелетом сразу приходит словарь читателя (ADR 0027). */
function StagedGlossary({
  sequence,
  glossary,
}: {
  readonly sequence: StagedLoading;
  readonly glossary: CourseGlossary;
}) {
  return (
    <Suspense fallback={<CourseGlossaryLoading />}>
      <PersonalGlossary glossary={glossary} sequence={sequence} />
    </Suspense>
  );
}

function PersonalGlossary({
  sequence,
  glossary,
}: {
  readonly sequence: StagedLoading;
  readonly glossary: CourseGlossary;
}) {
  use(sequence.personalPart);
  return <CourseGlossaryView glossary={glossary} />;
}

function measure(canvasElement: HTMLElement) {
  const column = "main [class*='max-w-']";
  // Ширина ряда возврата зависит от подписи; на месте должны остаться его начало и высота.
  const { width: _width, ...back } = boxOf(
    canvasElement,
    `${column} > :first-child`,
  );
  return {
    column: originOf(boxOf(canvasElement, column)),
    back,
    list: originOf(boxOf(canvasElement, `${column} > :last-child`)),
  };
}

/**
 * Скелет и словарь стоят на одном месте: колонка, ряд возврата и начало списка терминов не
 * сдвигаются, когда словарь пришёл.
 */
function loadsInPlace({
  globals,
  width,
}: StoryViewport): Pick<Story, "globals" | "loaders" | "render" | "play"> {
  return {
    globals,
    loaders: stagedLoaders,
    render: (args, { loaded }) => (
      <StagedGlossary
        glossary={args.glossary}
        sequence={stagedLoadingOf(loaded)}
      />
    ),
    play: async ({ canvasElement, loaded }) => {
      await settleStoryFrame(width);
      const sequence = stagedLoadingOf(loaded);
      const canvas = within(canvasElement);
      await expect(
        await canvas.findByLabelText("Словарь курса загружается"),
      ).toHaveAttribute("aria-busy", "true");
      const skeleton = measure(canvasElement);

      sequence.deliverPersonalPart();
      await canvas.findByRole("heading", { level: 1, name: "Словарь курса" });
      const ready = measure(canvasElement);

      await expect(ready).toEqual(skeleton);
    },
  };
}

export const LoadsInPlace: Story = loadsInPlace(desktop);
export const LoadsInPlaceMobile: Story = loadsInPlace(mobile);
