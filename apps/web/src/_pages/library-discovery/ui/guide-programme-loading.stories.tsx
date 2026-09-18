import type { Meta, StoryObj } from "@storybook/react-vite";
import { Suspense, use } from "react";
import { expect, within } from "storybook/test";

import { MaterialReadingContext, type MaterialPreview } from "@/entities/material";
import type { PublishedSeriesResult } from "@/features/library-discovery";
import { guideOnlyOffer } from "@/workshop/billing.fixtures";
import { boxOf, desktop, mobile, originOf, settleStoryFrame, stagedLoaders, stagedLoadingOf, type StagedLoading, type Box, type StoryViewport } from "@/workshop/loads-in-place";
import { publicPageEnvironment } from "@/workshop/story-environment";

import { GuideProgrammeView } from "./guide-programme-view.client";
import { GuideProgrammeLoading } from "./library-discovery-loading";
import { PendingSeries } from "./saved-series.client";

const titles = ["От идеи к первой версии", "Границы продукта", "Сценарии пользователя", "Модель предметной области", "Выбор технической основы", "Первый вертикальный срез", "Хранение данных", "Миграции без потери данных"];
/** Гостевая доступность — то, что лежит в общем кеше: бесплатное открыто, остальное под замком. */
const materials = titles.map((title, index): MaterialPreview => ({
  materialId: `programme-material-${String(index + 1)}`, slug: `programme-material-${String(index + 1)}`, title,
  access: index < 2 ? "free" : "membership", availability: index < 2 ? "available" : "locked", format: "Гайд", formatSlug: "guide",
  summary: "", topic: "Platform", topicSlug: "platform", tags: [],
  seriesMemberships: [{ name: "Создание Platform Inside", slug: "platform-inside", ordinal: index + 1 }],
}));
const chapters = ["Основа продукта", "Данные и доступ"].map((name, index) => ({
  id: `programme-chapter-${String(index + 1)}`,
  name,
  summary: "",
  materialIds: materials.slice(index * 4, index * 4 + 4).map(({ materialId }) => materialId ?? ""),
}));
const result = { chapters, discoveryKind: "series", kind: "ready", hasNext: false, reference: { id: "72000000-0000-4000-8000-000000000670", name: "Создание Platform Inside", slug: "platform-inside", summary: "От продуктовой идеи до работающего приложения." }, items: materials, relatedSeries: [], topics: [] } satisfies PublishedSeriesResult;

function StagedProgramme({ sequence, signedIn }: { readonly sequence: StagedLoading; readonly signedIn: boolean }) {
  return <Suspense fallback={<GuideProgrammeLoading />}><SharedPart sequence={sequence} signedIn={signedIn} /></Suspense>;
}

function SharedPart({ sequence, signedIn }: { readonly sequence: StagedLoading; readonly signedIn: boolean }) {
  use(sequence.sharedPart);
  return <Suspense fallback={<PendingSeries artifacts={{ artifacts: [], kind: "ready" }} result={result} />}><PersonalPart sequence={sequence} signedIn={signedIn} /></Suspense>;
}

/** Участнику продукт открыт целиком; гость видит замки и приглашение к оплате. */
const memberResult = { ...result, items: materials.map((item) => ({ ...item, availability: "available" as const })) } satisfies PublishedSeriesResult;

function PersonalPart({ sequence, signedIn }: { readonly sequence: StagedLoading; readonly signedIn: boolean }) {
  use(sequence.personalPart);
  return signedIn
    ? <GuideProgrammeView guideOffer={guideOnlyOffer} learning={{ kind: "ready", read: 1, total: materials.length, continuation: null }} result={memberResult} />
    : <GuideProgrammeView guideOffer={guideOnlyOffer} learning={{ kind: "guest" }} result={result} />;
}

interface ProgrammeGeometry { readonly back: Box; readonly header: Box; readonly firstRow: Box | null }

function measure(canvasElement: HTMLElement): ProgrammeGeometry {
  const firstRow = canvasElement.querySelector("[data-series-ordinal='1']");
  return {
    back: boxOf(canvasElement, "[data-programme-part='back']"),
    header: boxOf(canvasElement, "[data-programme-part='header']"),
    firstRow: firstRow === null ? null : boxOf(canvasElement, "[data-series-ordinal='1']"),
  };
}

const environment = publicPageEnvironment("/guides/platform-inside/programme");
const meta = {
  ...environment,
  component: GuideProgrammeView,
  title: "Pages/Guide/Programme loading",
  parameters: { ...environment.parameters, docs: { description: { component: "Переход в программу: скелет маршрута, общая часть из гостевого кеша и личная часть встают на одно место (#670)." } } },
  args: { result },
} satisfies Meta<typeof GuideProgrammeView>;
export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Скелет, общая часть и готовая программа не имеют права двигать друг друга: ряд возврата и шапка
 * стоят на месте с первого кадра, а между общей частью и готовой программой на месте остаются ещё
 * высота шапки и первый урок. Расхождение между состояниями роняет историю.
 */
function loadsInPlace({ globals, width }: StoryViewport, signedIn: boolean): Pick<Story, "decorators" | "globals" | "loaders" | "render" | "play"> {
  return {
    globals,
    decorators: [(Story) => <MaterialReadingContext value={{ accountId: signedIn ? "story-account" : null, resolved: true, states: new Map(), register: () => () => undefined, refresh: () => Promise.resolve(), failed: false }}><Story /></MaterialReadingContext>],
    loaders: stagedLoaders,
    render: (_args, { loaded }) => <StagedProgramme sequence={stagedLoadingOf(loaded)} signedIn={signedIn} />,
    play: async ({ canvasElement, loaded }) => {
      await settleStoryFrame(width);
      const sequence = stagedLoadingOf(loaded);
      const canvas = within(canvasElement);
      await expect(await canvas.findByLabelText("Программа загружается")).toHaveAttribute("aria-busy", "true");
      const skeleton = measure(canvasElement);

      sequence.deliverSharedPart();
      await canvas.findByRole("heading", { level: 1, name: "Создание Platform Inside" });
      await expect(canvasElement.querySelectorAll("[data-series-access-pending]").length).toBe(materials.length - 2);
      const sharedPart = measure(canvasElement);

      sequence.deliverPersonalPart();
      if (signedIn) await canvas.findByRole("progressbar", { name: "Прогресс продукта" });
      else await canvas.findByRole("link", { name: "Оплатить сейчас" });
      await expect(canvasElement.querySelector("[data-series-access-pending]")).toBeNull();
      const ready = measure(canvasElement);

      await expect(skeleton.back).toEqual(ready.back);
      await expect(originOf(skeleton.header)).toEqual(originOf(ready.header));
      await expect(sharedPart).toEqual(ready);
    },
  };
}

export const GuestLoadsInPlace: Story = { ...loadsInPlace(desktop, false) };
export const GuestLoadsInPlaceMobile: Story = { ...loadsInPlace(mobile, false) };
export const MemberLoadsInPlace: Story = { ...loadsInPlace(desktop, true) };
export const MemberLoadsInPlaceMobile: Story = { ...loadsInPlace(mobile, true) };
