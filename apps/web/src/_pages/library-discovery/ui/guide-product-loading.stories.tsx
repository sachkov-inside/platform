import type { Meta, StoryObj } from "@storybook/react-vite";
import { useParams } from "next/navigation";
import { Suspense, use } from "react";
import { expect, mocked, within } from "storybook/test";

import { aiFirstGuide } from "@/features/ai-first-guide";
import type { PublishedSeriesResult } from "@/features/library-discovery";
import { homeMaterialReaderReturnTarget } from "@/shared/routing/material-reader";
import { boxOf, desktop, mobile, originOf, settleStoryFrame, stagedLoaders, stagedLoadingOf, type StagedLoading, type StoryViewport } from "@/workshop/loads-in-place";
import { publicPageEnvironment } from "@/workshop/story-environment";

import { GuideProductView } from "./guide-product-view";
import { GuideProductLoading } from "./library-discovery-loading";

type ResolvedSeries = Extract<PublishedSeriesResult, { readonly kind: "ready" | "empty" }>;

const product = {
  kind: "empty", discoveryKind: "series", relatedSeries: [], topics: [],
  chapters: [{ id: "product-chapter-1", materialIds: [], name: "Основа продукта", summary: "С чего начинается работа." }],
  reference: {
    name: "Создание Platform Inside", slug: "platform-inside", summary: "От продуктовой идеи до работающего приложения.",
    introduction: { audience: "Разработчикам, которые собирают продукт с агентами.", outcome: "Работающее приложение и процесс.", prerequisites: "Базовый опыт разработки.", scope: "Без найма и маркетинга." },
  },
} satisfies ResolvedSeries;
const aiFirstProduct = {
  kind: "empty", discoveryKind: "series", chapters: [], relatedSeries: [], topics: [],
  reference: { name: "AI-first разработка", slug: aiFirstGuide.slug, summary: aiFirstGuide.description },
} satisfies ResolvedSeries;

/** Страница продукта целиком общая (ADR 0026), поэтому слоёв два: скелет маршрута и сама страница. */
function StagedProduct({ result, sequence }: { readonly result: ResolvedSeries; readonly sequence: StagedLoading }) {
  return <Suspense fallback={<GuideProductLoading />}><ProductPage result={result} sequence={sequence} /></Suspense>;
}

function ProductPage({ result, sequence }: { readonly result: ResolvedSeries; readonly sequence: StagedLoading }) {
  use(sequence.sharedPart);
  return <GuideProductView result={result} returnTarget={homeMaterialReaderReturnTarget} />;
}

/** Высота обложки и заголовка зависит от данных; на месте обязаны стоять ряд возврата и начало первого экрана. */
const frameOf = (canvasElement: HTMLElement) => ({
  back: boxOf(canvasElement, "[data-product-part='back']"),
  hero: originOf(boxOf(canvasElement, "[data-product-part='hero']")),
});

const environment = publicPageEnvironment("/guides/platform-inside");
const meta = {
  ...environment,
  component: GuideProductView,
  title: "Pages/Guide/Product loading",
  parameters: { ...environment.parameters, docs: { description: { component: "Переход на страницу продукта: скелет повторяет раскладку именно этого продукта, практикум AI-first свёрстан иначе (#670)." } } },
  args: { result: product, returnTarget: homeMaterialReaderReturnTarget },
} satisfies Meta<typeof GuideProductView>;
export default meta;
type Story = StoryObj<typeof meta>;

function loadsInPlace({ globals, width }: StoryViewport, result: ResolvedSeries): Pick<Story, "beforeEach" | "globals" | "loaders" | "render" | "play"> {
  return {
    globals,
    // При переходе адрес известен клиентскому роутеру: по нему скелет выбирает раскладку продукта.
    beforeEach: () => {
      environment.beforeEach();
      mocked(useParams).mockReturnValue({ slug: result.reference.slug });
    },
    loaders: stagedLoaders,
    render: (_args, { loaded }) => <StagedProduct result={result} sequence={stagedLoadingOf(loaded)} />,
    play: async ({ canvasElement, loaded }) => {
      await settleStoryFrame(width);
      const canvas = within(canvasElement);
      await expect(await canvas.findByLabelText("Продукт загружается")).toHaveAttribute("aria-busy", "true");
      const skeleton = frameOf(canvasElement);

      stagedLoadingOf(loaded).deliverSharedPart();
      await canvas.findByRole("heading", { level: 1, name: result.reference.name });
      await expect(canvas.queryByLabelText("Продукт загружается")).toBeNull();

      await expect(skeleton).toEqual(frameOf(canvasElement));
    },
  };
}

export const ProductLoadsInPlace: Story = { ...loadsInPlace(desktop, product) };
export const ProductLoadsInPlaceMobile: Story = { ...loadsInPlace(mobile, product) };
export const AiFirstLoadsInPlace: Story = { ...loadsInPlace(desktop, aiFirstProduct) };
export const AiFirstLoadsInPlaceMobile: Story = { ...loadsInPlace(mobile, aiFirstProduct) };
