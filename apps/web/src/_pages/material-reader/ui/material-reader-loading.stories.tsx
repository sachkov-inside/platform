import type { Meta, StoryObj } from "@storybook/react-vite";
import { Suspense, use } from "react";
import { expect, within } from "storybook/test";

import type {
  MaterialReaderMetadata,
  ReaderBlock,
} from "@/_pages/material-reader/model/material-reader-view";
import { resolveSeriesReaderContext } from "@/_pages/material-reader/model/series-reader-context";
import { parseMaterialReaderReturnTarget } from "@/shared/routing/material-reader";
import { guidePurchaseHref } from "@/shared/routing/subscription-route";
import { boxOf, desktop, mobile, originOf, settleStoryFrame, stagedLoaders, stagedLoadingOf, type StagedLoading, type StoryViewport } from "@/workshop/loads-in-place";
import { publicPageEnvironment } from "@/workshop/story-environment";

import {
  MaterialReaderAccess,
  MaterialReaderLoading,
  MaterialReaderPending,
} from "./material-reader-states";
import { MaterialReaderView } from "./material-reader-view";

const material = {
  materialId: "02000000-0000-4000-8000-000000000670",
  contentVersion: 1,
  access: "membership",
  cover: null,
  format: { name: "Гайд", slug: "guide" },
  difficulty: "basic",
  outcomes: ["Понимать, как страница приходит слоями", "Проверять, что шапка стоит на месте"],
  publishedAt: "2026-09-17T05:00:00.000Z",
  seriesMemberships: [{ ordinal: 3, series: { name: "Создание Platform Inside", slug: "platform-inside" } }],
  slug: "instant-navigation",
  summary: "Общая часть урока приходит из кеша сразу, а закрытое тело стримится на своё место.",
  tags: [],
  title: "Как урок открывается без чужого скелета",
  topic: { name: "Platform", slug: "platform" },
} as const satisfies MaterialReaderMetadata;

const body = Array.from({ length: 8 }, (_, index): ReaderBlock => ({
  kind: "paragraph",
  content: [{ kind: "text", marks: [], text: `Абзац ${String(index + 1)}. Текст урока занимает место, которое до него держали строки скелета, и не двигает шапку.` }],
}));

const returnTarget = parseMaterialReaderReturnTarget("/guides/platform-inside/programme");
const seriesContext = resolveSeriesReaderContext({
  currentMaterialSlug: material.slug,
  returnTarget,
  series: {
    items: [{ slug: "first-lesson", title: "Первый урок" }, { slug: material.slug, title: material.title }, { slug: "next-lesson", title: "Следующий урок" }],
    kind: "ready",
    reference: { name: "Создание Platform Inside", slug: "platform-inside" },
  },
});

type Outcome = "opened" | "locked";

function StagedReader({ outcome, sequence }: { readonly outcome: Outcome; readonly sequence: StagedLoading }) {
  return <Suspense fallback={<MaterialReaderLoading />}><SharedPart outcome={outcome} sequence={sequence} /></Suspense>;
}

function SharedPart({ outcome, sequence }: { readonly outcome: Outcome; readonly sequence: StagedLoading }) {
  use(sequence.sharedPart);
  return <Suspense fallback={<MaterialReaderPending material={material} returnTarget={returnTarget} seriesContext={seriesContext} />}><PersonalPart outcome={outcome} sequence={sequence} /></Suspense>;
}

function PersonalPart({ outcome, sequence }: { readonly outcome: Outcome; readonly sequence: StagedLoading }) {
  use(sequence.personalPart);
  return outcome === "opened"
    ? <MaterialReaderView body={body} material={material} primaryVideo={null} returnTarget={returnTarget} seriesContext={seriesContext} />
    : <div className="@container/material-reader"><MaterialReaderAccess invitation={{ href: guidePurchaseHref("platform-inside"), kind: "guide" }} material={material} returnTarget={returnTarget} seriesContext={seriesContext} /></div>;
}

const measure = (canvasElement: HTMLElement) => ({
  header: boxOf(canvasElement, "[data-reader-header]"),
  returnRow: boxOf(canvasElement, "[data-reader-return='top']"),
});

const environment = publicPageEnvironment("/materials/instant-navigation");
const meta = {
  ...environment,
  component: MaterialReaderView,
  title: "Pages/Material Reader/Loading",
  parameters: { ...environment.parameters, docs: { description: { component: "Переход в урок: скелет маршрута, общая часть из гостевого кеша и личная часть встают на одно место (#670)." } } },
  args: { body, material, primaryVideo: null },
} satisfies Meta<typeof MaterialReaderView>;
export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Ряд возврата и начало шапки стоят на месте с первого кадра скелета. Когда общая часть известна,
 * шапка уже настоящая, и личная часть — открытое тело или отказ с приглашением — её не двигает.
 */
function loadsInPlace({ globals, width }: StoryViewport, outcome: Outcome): Pick<Story, "globals" | "loaders" | "render" | "play"> {
  return {
    globals,
    loaders: stagedLoaders,
    render: (_args, { loaded }) => <StagedReader outcome={outcome} sequence={stagedLoadingOf(loaded)} />,
    play: async ({ canvasElement, loaded }) => {
      await settleStoryFrame(width);
      const sequence = stagedLoadingOf(loaded);
      const canvas = within(canvasElement);
      await expect(await canvas.findByLabelText("Материал загружается")).toHaveAttribute("aria-busy", "true");
      const skeleton = measure(canvasElement);

      sequence.deliverSharedPart();
      await canvas.findByRole("heading", { level: 1, name: material.title });
      await expect(canvas.getByLabelText("Текст материала загружается")).toHaveAttribute("aria-busy", "true");
      const sharedPart = measure(canvasElement);

      sequence.deliverPersonalPart();
      if (outcome === "opened") await canvas.findByText(/^Абзац 1\./u);
      else await canvas.findByRole("link", { name: /Купить продукт/u });
      const ready = measure(canvasElement);

      await expect(skeleton.returnRow).toEqual(ready.returnRow);
      await expect(originOf(skeleton.header)).toEqual(originOf(ready.header));
      await expect(sharedPart).toEqual(ready);
    },
  };
}

export const OpenedLoadsInPlace: Story = { ...loadsInPlace(desktop, "opened") };
export const OpenedLoadsInPlaceMobile: Story = { ...loadsInPlace(mobile, "opened") };
export const LockedLoadsInPlace: Story = { ...loadsInPlace(desktop, "locked") };
export const LockedLoadsInPlaceMobile: Story = { ...loadsInPlace(mobile, "locked") };
