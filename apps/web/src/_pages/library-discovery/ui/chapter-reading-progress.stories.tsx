import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, waitFor, within } from "storybook/test";
import { z } from "zod";

import type { MaterialPreview } from "@/entities/material";
import type { PublishedProductResult } from "@/features/library-discovery";
import { ReadingProgressProvider } from "@/features/reading-progress";
import { fetchBeforeRender } from "@/storybook/mutation-mock";
import { publicPageEnvironment } from "@/storybook/story-environment";

import { ProductLearningProvider } from "./product-learning.client";
import { ProductProgrammeView } from "./product-programme-view";

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
  // Ordinary long titles keep the twelfth row outside the native reveal-ahead area.
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

/** The chapter counts saved marks for lessons whose rows have not been revealed yet. */
export const IncludesUnrevealedLessons: Story = {
  globals: { viewport: { value: "mobile390", isRotated: false } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    try {
      await waitFor(() => expect(requested.flat().sort()).toEqual(chapterIds));
      const rows = canvasElement.querySelectorAll("[data-product-ordinal]");
      await expect(rows).toHaveLength(12);
      await expect(
        canvasElement.querySelector(
          '[data-route-material="chapter-progress-lesson-24"]',
        ),
      ).not.toBeInTheDocument();
      const boundary = canvasElement.querySelector(
        '[data-product-ordinal="12"]',
      );
      if (!(boundary instanceof HTMLElement))
        throw new Error("Missing twelfth lesson boundary");
      await expect(window.innerWidth).toBe(390);
      await expect(boundary.getBoundingClientRect().top).toBeGreaterThan(
        window.innerHeight + 600,
      );
      const counter = canvas.getByLabelText(
        "Прогресс главы «Учебный проект» загружается",
      );
      await expect(counter).toBeVisible();
      await expect(counter).toHaveTextContent("… из 24");
      console.info(
        "Chapter progress baseline",
        JSON.stringify({
          phase: "response-held",
          rowCount: rows.length,
          unrevealed24Mounted: false,
          boundaryTop: boundary.getBoundingClientRect().top,
          rootBottom: window.innerHeight,
          documentScroll: document.scrollingElement?.scrollTop,
          requested,
          counter: counter.textContent,
          accessibleName: counter.getAttribute("aria-label"),
        }),
      );

      releaseStates?.();
      await waitFor(() =>
        expect(counter).toHaveAttribute(
          "aria-label",
          "Изучено 3 из 24 материалов главы «Учебный проект»",
        ),
      );
      await expect(counter).toHaveTextContent("3 из 24");
      await expect(
        canvasElement.querySelectorAll("[data-product-ordinal]"),
      ).toHaveLength(12);
      await expect(
        canvasElement.querySelector(
          '[data-route-material="chapter-progress-lesson-24"]',
        ),
      ).not.toBeInTheDocument();
      await expect(requested.flat().sort()).toEqual(chapterIds);
      console.info(
        "Chapter progress baseline",
        JSON.stringify({
          phase: "response-committed",
          rowCount: canvasElement.querySelectorAll("[data-product-ordinal]")
            .length,
          unrevealed24Mounted: false,
          counter: counter.textContent,
          accessibleName: counter.getAttribute("aria-label"),
        }),
      );
    } finally {
      releaseStates?.();
    }
  },
};
