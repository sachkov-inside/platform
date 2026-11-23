import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Activity, useState } from "react";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { z } from "zod";

import type { MaterialPreview } from "@/entities/material";
import type { PublishedProductResult } from "@/features/library-discovery";
import {
  ProductMaterialMarker,
  ReadingProgressProvider,
} from "@/features/reading-progress";
import { Button } from "@/shared/ui/button";
import { fetchBeforeRender } from "@/storybook/mutation-mock";
import { publicPageEnvironment } from "@/storybook/story-environment";

import { ProductLearningProvider } from "./product-learning.client";
import { ProductProgrammeView } from "./product-programme-view";
import { ChapterReadingProgress } from "./chapter-reading-progress.client";

const chapterIds = [
  "41000000-0000-4000-8000-000000000001",
  "41000000-0000-4000-8000-000000000002",
  "41000000-0000-4000-8000-000000000003",
  "41000000-0000-4000-8000-000000000004",
  "41000000-0000-4000-8000-000000000005",
  "41000000-0000-4000-8000-000000000006",
  "41000000-0000-4000-8000-000000000007",
  "41000000-0000-4000-8000-000000000008",
  "41000000-0000-4000-8000-000000000009",
  "41000000-0000-4000-8000-000000000010",
  "41000000-0000-4000-8000-000000000011",
  "41000000-0000-4000-8000-000000000012",
  "41000000-0000-4000-8000-000000000013",
  "41000000-0000-4000-8000-000000000014",
  "41000000-0000-4000-8000-000000000015",
  "41000000-0000-4000-8000-000000000016",
  "41000000-0000-4000-8000-000000000017",
  "41000000-0000-4000-8000-000000000018",
  "41000000-0000-4000-8000-000000000019",
  "41000000-0000-4000-8000-000000000020",
  "41000000-0000-4000-8000-000000000021",
  "41000000-0000-4000-8000-000000000022",
  "41000000-0000-4000-8000-000000000023",
  "41000000-0000-4000-8000-000000000024",
];
const studiedIds = [
  "41000000-0000-4000-8000-000000000001",
  "41000000-0000-4000-8000-000000000013",
  "41000000-0000-4000-8000-000000000024",
];
const materials = chapterIds.map((materialId, index): MaterialPreview => ({
  materialId,
  slug: `chapter-progress-lesson-${String(index + 1)}`,
  // Long titles keep row 12 beyond the 600px reveal margin (product-journey-controls.client.tsx).
  title:
    `Урок ${String(index + 1)}. Как собрать понятный учебный проект: ` +
    "от первой идеи и сценариев пользователя до работающего приложения, " +
    "его проверки, публикации, наблюдения за ошибками и последующего развития " +
    "на примере самостоятельного синтетического проекта без внешних сервисов",
  summary: "",
  access: "free",
  availability: "available",
  format: "Гайд",
  formatSlug: "guide",
  topic: "Учебный проект",
  topicSlug: "chapter-progress",
  tags: [],
  productMemberships: [
    {
      name: "Прогресс главы",
      slug: "chapter-progress",
      ordinal: index + 1,
    },
  ],
}));
const result = {
  kind: "ready",
  discoveryKind: "product",
  hasNext: false,
  reference: { name: "Прогресс главы", slug: "chapter-progress", summary: "" },
  chapters: [
    {
      id: "42000000-0000-4000-8000-000000000001",
      name: "Учебный проект",
      summary: "",
      materialIds: chapterIds,
    },
  ],
  items: materials,
  relatedProduct: [],
  topics: [],
} satisfies PublishedProductResult;
const environment = publicPageEnvironment(
  "/products/chapter-progress/programme",
  {
    account: "authenticated",
  },
);
const requested: string[][] = [];
let client: QueryClient;
let releaseStates: (() => void) | undefined;

function ChapterProgramme() {
  return (
    <QueryClientProvider client={client}>
      <ReadingProgressProvider
        accountId="43000000-0000-4000-8000-000000000001"
        resolved
      >
        <ProductLearningProvider
          learning={{ kind: "ready", read: 3, total: 24, continuation: null }}
        >
          <ProductProgrammeView result={result} productOpen />
        </ProductLearningProvider>
      </ReadingProgressProvider>
    </QueryClientProvider>
  );
}

const meta = {
  ...environment,
  title: "Pages/Product/Chapter reading progress",
  component: ChapterProgramme,
  beforeEach: () => {
    const restoreEnvironment = environment.beforeEach();
    client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity } },
    });
    requested.length = 0;
    const reply = Promise.withResolvers<undefined>();
    releaseStates = () => {
      reply.resolve(undefined);
    };
    const restoreFetch = fetchBeforeRender(async (input, init) => {
      const request =
        input instanceof Request
          ? input
          : new Request(new URL(String(input), window.location.origin), init);
      const path = new URL(request.url).pathname;
      if (path !== "/api/reading-progress/states" || request.method !== "POST")
        throw new Error(
          `Unexpected chapter fixture request: ${request.method} ${path}`,
        );
      const { materialIds } = z
        .strictObject({ materialIds: z.array(z.uuid()).min(1).max(100) })
        .parse(await request.json());
      requested.push(materialIds);
      await reply.promise;
      return Response.json({
        kind: "ready",
        states: materialIds.map((materialId) => ({
          materialId,
          isRead: studiedIds.includes(materialId),
          version: 1,
          readAt: null,
          updatedAt: null,
          updateNote: null,
          openedParts: null,
        })),
      });
    })();
    return () => {
      reply.resolve(undefined);
      restoreFetch();
      client.clear();
      restoreEnvironment?.();
      releaseStates = undefined;
    };
  },
} satisfies Meta<typeof ChapterProgramme>;
export default meta;
type Story = StoryObj<typeof meta>;

/** The chapter tile counts saved marks for every lesson, though its rows wait for the chapter window. */
export const IncludesUnrevealedLessons: Story = {
  globals: { viewport: { value: "mobile390", isRotated: false } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    try {
      await waitFor(() => expect(requested.flat().sort()).toEqual(chapterIds));
      await expect(
        canvasElement.querySelectorAll("[data-product-ordinal]"),
      ).toHaveLength(0);
      const tile = canvasElement.querySelector<HTMLElement>(
        "[data-chapter-tile]",
      );
      if (tile === null) throw new Error("Missing chapter tile");
      // While the marks load, the tile names the size of the chapter.
      await expect(tile).toHaveTextContent("24 урока");
      releaseStates?.();
      const counter = await canvas.findByLabelText(
        "Изучено 3 из 24 материалов главы «Учебный проект»",
      );
      await expect(counter).toBeVisible();
      await expect(counter).toHaveTextContent("3 из 24");
      await expect(requested.flat().sort()).toEqual(chapterIds);
    } finally {
      releaseStates?.();
    }
  },
};

const overlapAccount = "43000000-0000-4000-8000-000000000002";
const sharedId = "41000000-0000-4000-8000-000000000001";
const chapterOnlyId = "41000000-0000-4000-8000-000000000002";
const overlapIds = [sharedId, chapterOnlyId];
const observerEvents: {
  readonly phase: string;
  readonly type: "observerAdded" | "observerRemoved";
  readonly materialId: string;
  readonly active: boolean;
  readonly observers: number;
  readonly at: number;
}[] = [];
let lifecyclePhase = "initial";
const overlapKey = (materialId: string) => [
  "reading-progress",
  overlapAccount,
  "material",
  materialId,
];
const observedKey = z.tuple([
  z.literal("reading-progress"),
  z.literal(overlapAccount),
  z.literal("material"),
  z.enum([sharedId, chapterOnlyId]),
]);

function OverlappingOwners() {
  const [chapter, setChapter] = useState(true);
  const [marker, setMarker] = useState(true);
  return (
    <QueryClientProvider client={client}>
      <ReadingProgressProvider accountId={overlapAccount} resolved>
        <h1>Регистрация прогресса главы</h1>
        <Button
          disabled={!chapter}
          onClick={() => {
            setChapter(false);
          }}
        >
          Убрать счётчик главы
        </Button>
        <Button
          disabled={!marker}
          onClick={() => {
            setMarker(false);
          }}
        >
          Убрать отметку материала
        </Button>
        {chapter ? (
          <ChapterReadingProgress materialIds={overlapIds} name="Перекрытие" />
        ) : null}
        {marker ? (
          <ProductMaterialMarker materialId={sharedId} ordinal={1} />
        ) : null}
      </ReadingProgressProvider>
    </QueryClientProvider>
  );
}

function findOverlapQuery(materialId: string) {
  return client
    .getQueryCache()
    .find({ queryKey: overlapKey(materialId), exact: true });
}

function recordOverlapQueries(counter: HTMLElement) {
  console.info(
    "Chapter query lifecycle",
    JSON.stringify({
      phase: lifecyclePhase,
      counterConnected: counter.isConnected,
      counter: counter.textContent,
      accessibleName: counter.getAttribute("aria-label"),
      queries: overlapIds.map((materialId) => {
        const query = findOverlapQuery(materialId);
        return {
          materialId,
          cached: query !== undefined,
          active: query?.isActive() ?? false,
          observers: query?.getObserversCount() ?? 0,
        };
      }),
      requested,
      observerEvents,
    }),
  );
}

function observeOverlapQueries() {
  observerEvents.length = 0;
  lifecyclePhase = "initial";
  return client.getQueryCache().subscribe((event) => {
    const key = observedKey.safeParse(event.query.queryKey);
    if (
      !key.success ||
      (event.type !== "observerAdded" && event.type !== "observerRemoved")
    )
      return;
    observerEvents.push({
      phase: lifecyclePhase,
      type: event.type,
      materialId: key.data[3],
      active: event.query.isActive(),
      observers: event.query.getObserversCount(),
      at: performance.now(),
    });
  });
}

/** Public cache membership distinguishes active subscriptions from retained cached data. */
export const ReleasesOnlyTheRemovedOwner: Story = {
  render: () => <OverlappingOwners />,
  beforeEach: observeOverlapQueries,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    try {
      await waitFor(() => expect(requested.flat().sort()).toEqual(overlapIds));
      const shared = findOverlapQuery(sharedId);
      const chapterOnly = findOverlapQuery(chapterOnlyId);
      if (shared === undefined || chapterOnly === undefined)
        throw new Error("Missing actual reading-progress queries");
      await expect(shared.isActive()).toBe(true);
      await expect(chapterOnly.isActive()).toBe(true);
      await expect(shared.getObserversCount()).toBe(1);
      await expect(chapterOnly.getObserversCount()).toBe(1);
      releaseStates?.();
      const counter = await canvas.findByLabelText(
        "Изучено 1 из 2 материалов главы «Перекрытие»",
      );
      const marker = await canvas.findByRole("img", {
        name: "Материал 1, изучен",
      });
      await expect(counter).toBeVisible();
      await expect(marker).toBeVisible();

      lifecyclePhase = "remove-chapter";
      await userEvent.click(
        canvas.getByRole("button", { name: "Убрать счётчик главы" }),
      );
      await waitFor(() => expect(chapterOnly.isActive()).toBe(false));
      await expect(counter).not.toBeInTheDocument();
      await expect(chapterOnly.getObserversCount()).toBe(0);
      await expect(findOverlapQuery(chapterOnlyId)).toBe(chapterOnly);
      await expect(shared.isActive()).toBe(true);
      await expect(shared.getObserversCount()).toBe(1);
      await expect(
        canvas.getByRole("img", { name: "Материал 1, изучен" }),
      ).toBe(marker);
      await expect(observerEvents).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            phase: "remove-chapter",
            type: "observerRemoved",
            materialId: chapterOnlyId,
            active: false,
            observers: 0,
          }),
        ]),
      );
      recordOverlapQueries(counter);

      lifecyclePhase = "remove-last-consumer";
      await userEvent.click(
        canvas.getByRole("button", { name: "Убрать отметку материала" }),
      );
      await waitFor(() => expect(shared.isActive()).toBe(false));
      await expect(marker).not.toBeInTheDocument();
      await expect(shared.getObserversCount()).toBe(0);
      await expect(findOverlapQuery(sharedId)).toBe(shared);
      await expect(observerEvents).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            phase: "remove-last-consumer",
            type: "observerRemoved",
            materialId: sharedId,
            active: false,
            observers: 0,
          }),
        ]),
      );
      recordOverlapQueries(counter);
    } finally {
      releaseStates?.();
    }
  },
};

function PendingRetainedChapter() {
  const [ready, setReady] = useState(false);
  const [visible, setVisible] = useState(true);
  return (
    <QueryClientProvider client={client}>
      <ReadingProgressProvider accountId={overlapAccount} resolved={ready}>
        <h1>Готовность прогресса главы</h1>
        <Button
          disabled={ready}
          onClick={() => {
            setReady(true);
          }}
        >
          Подтвердить аккаунт
        </Button>
        <Button
          onClick={() => {
            setVisible((value) => !value);
          }}
        >
          {visible ? "Скрыть главу" : "Вернуть главу"}
        </Button>
        <Activity mode={visible ? "visible" : "hidden"}>
          <ChapterReadingProgress materialIds={overlapIds} name="Ожидание" />
        </Activity>
      </ReadingProgressProvider>
    </QueryClientProvider>
  );
}

export const KeepsPendingOwnerAndRetainedChapter: Story = {
  beforeEach: observeOverlapQueries,
  render: () => <PendingRetainedChapter />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    try {
      lifecyclePhase = "pending";
      const counter = canvas.getByLabelText(
        "Прогресс главы «Ожидание» загружается",
      );
      await expect(counter).toBeVisible();
      await waitFor(() =>
        expect(findOverlapQuery(chapterOnlyId)).toBeDefined(),
      );
      const shared = findOverlapQuery(sharedId);
      const chapterOnly = findOverlapQuery(chapterOnlyId);
      if (shared === undefined || chapterOnly === undefined)
        throw new Error("Missing pending reading-progress queries");
      await expect(shared.isActive()).toBe(false);
      await expect(chapterOnly.isActive()).toBe(false);
      await expect(shared.getObserversCount()).toBe(1);
      await expect(chapterOnly.getObserversCount()).toBe(1);
      await expect(requested).toHaveLength(0);
      recordOverlapQueries(counter);

      lifecyclePhase = "ready";
      await userEvent.click(
        canvas.getByRole("button", { name: "Подтвердить аккаунт" }),
      );
      await waitFor(() => expect(requested.flat().sort()).toEqual(overlapIds));
      await expect(shared.isActive()).toBe(true);
      await expect(chapterOnly.isActive()).toBe(true);
      await expect(
        canvas.getByLabelText("Прогресс главы «Ожидание» загружается"),
      ).toBe(counter);
      await expect(findOverlapQuery(sharedId)).toBe(shared);
      await expect(findOverlapQuery(chapterOnlyId)).toBe(chapterOnly);
      releaseStates?.();
      await waitFor(() =>
        expect(counter).toHaveAttribute(
          "aria-label",
          "Изучено 1 из 2 материалов главы «Ожидание»",
        ),
      );
      await expect(counter).toHaveTextContent("1 из 2");
      recordOverlapQueries(counter);

      lifecyclePhase = "hidden";
      await userEvent.click(
        canvas.getByRole("button", { name: "Скрыть главу" }),
      );
      await expect(counter).toBeInTheDocument();
      await expect(counter).not.toBeVisible();
      await waitFor(() => expect(shared.isActive()).toBe(false));
      await expect(chapterOnly.isActive()).toBe(false);
      await expect(shared.getObserversCount()).toBe(0);
      await expect(chapterOnly.getObserversCount()).toBe(0);
      await expect(findOverlapQuery(sharedId)).toBe(shared);
      await expect(findOverlapQuery(chapterOnlyId)).toBe(chapterOnly);
      recordOverlapQueries(counter);

      lifecyclePhase = "returned";
      await userEvent.click(
        canvas.getByRole("button", { name: "Вернуть главу" }),
      );
      await waitFor(() => expect(shared.isActive()).toBe(true));
      await expect(chapterOnly.isActive()).toBe(true);
      await expect(shared.getObserversCount()).toBe(1);
      await expect(chapterOnly.getObserversCount()).toBe(1);
      await waitFor(() =>
        expect(counter).toHaveAttribute(
          "aria-label",
          "Изучено 1 из 2 материалов главы «Ожидание»",
        ),
      );
      await expect(counter).toBeVisible();
      await expect(
        canvas.getByLabelText("Изучено 1 из 2 материалов главы «Ожидание»"),
      ).toBe(counter);
      await expect(findOverlapQuery(sharedId)).toBe(shared);
      await expect(findOverlapQuery(chapterOnlyId)).toBe(chapterOnly);
      await waitFor(() => expect(requested).toEqual([overlapIds, overlapIds]));
      recordOverlapQueries(counter);
    } finally {
      releaseStates?.();
    }
  },
};
