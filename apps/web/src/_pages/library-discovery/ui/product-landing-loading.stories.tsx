import type { Meta, StoryObj } from "@storybook/react-vite";
import { Suspense, use } from "react";
import { expect, within } from "storybook/test";

import type { PublishedSeriesResult } from "@/features/library-discovery";
import { homeMaterialReaderReturnTarget } from "@/shared/routing/material-reader";
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
import { publicPageEnvironment } from "@/storybook/story-environment";

import {
  aiEngineeringCoursePage,
  aiEngineeringCourseChapters,
} from "@/storybook/ai-engineering-course.fixtures";

import { ProductLandingView } from "./product-landing-view";
import { ProductLandingLoading } from "./library-discovery-loading";

type ResolvedSeries = Extract<
  PublishedSeriesResult,
  { readonly kind: "ready" | "empty" }
>;

const product = {
  kind: "empty",
  discoveryKind: "series",
  relatedSeries: [],
  topics: [],
  chapters: aiEngineeringCourseChapters,
  reference: {
    name: "AI Engineering",
    slug: "ai-engineering",
    summary: "",
    productPage: {
      presentation: "ai-engineering-course",
      page: aiEngineeringCoursePage,
    },
  },
} satisfies ResolvedSeries;
/** Страница продукта целиком общая (ADR 0027), поэтому слоёв два: скелет маршрута и сама страница. */
function StagedProduct({
  result,
  sequence,
}: {
  readonly result: ResolvedSeries;
  readonly sequence: StagedLoading;
}) {
  return (
    <Suspense fallback={<ProductLandingLoading />}>
      <ProductPage result={result} sequence={sequence} />
    </Suspense>
  );
}

function ProductPage({
  result,
  sequence,
}: {
  readonly result: ResolvedSeries;
  readonly sequence: StagedLoading;
}) {
  use(sequence.sharedPart);
  return (
    <ProductLandingView
      result={result}
      returnTarget={homeMaterialReaderReturnTarget}
    />
  );
}

/** Высота обложки и заголовка зависит от данных; на месте обязаны стоять ряд возврата и начало первого экрана. */
const frameOf = (canvasElement: HTMLElement) => ({
  back: boxOf(canvasElement, "[data-product-part='back']"),
  hero: originOf(boxOf(canvasElement, "[data-product-part='hero']")),
});

const environment = publicPageEnvironment("/products/ai-engineering");
const meta = {
  ...environment,
  component: ProductLandingView,
  title: "Pages/Product/Product loading",
  parameters: {
    ...environment.parameters,
    docs: {
      description: {
        component:
          "Переход на страницу продукта: скелет повторяет раскладку страницы, поэтому готовая страница встаёт на его место (#670).",
      },
    },
  },
  args: { result: product, returnTarget: homeMaterialReaderReturnTarget },
} satisfies Meta<typeof ProductLandingView>;
export default meta;
type Story = StoryObj<typeof meta>;

function loadsInPlace(
  { globals, width }: StoryViewport,
  result: ResolvedSeries,
): Pick<Story, "beforeEach" | "globals" | "loaders" | "render" | "play"> {
  return {
    globals,
    beforeEach: environment.beforeEach,
    loaders: stagedLoaders,
    render: (_args, { loaded }) => (
      <StagedProduct result={result} sequence={stagedLoadingOf(loaded)} />
    ),
    play: async ({ canvasElement, loaded }) => {
      await settleStoryFrame(width);
      const canvas = within(canvasElement);
      await expect(
        await canvas.findByLabelText("Продукт загружается"),
      ).toHaveAttribute("aria-busy", "true");
      const skeleton = frameOf(canvasElement);

      stagedLoadingOf(loaded).deliverSharedPart();
      await canvas.findByRole("heading", {
        level: 1,
        name: new RegExp(`^${result.reference.name}`, "u"),
      });
      await expect(canvas.queryByLabelText("Продукт загружается")).toBeNull();

      await expect(skeleton).toEqual(frameOf(canvasElement));
    },
  };
}

export const ProductLoadsInPlace: Story = { ...loadsInPlace(desktop, product) };
export const ProductLoadsInPlaceMobile: Story = {
  ...loadsInPlace(mobile, product),
};
