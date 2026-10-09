import type { Meta, StoryObj } from "@storybook/react-vite";
import { ReadonlyURLSearchParams, useSearchParams } from "next/navigation";
import { useState, type ComponentProps } from "react";
import { expect, mocked, userEvent, waitFor, within } from "storybook/test";
import {
  MaterialReadingScope,
  type MaterialPreview,
} from "@/entities/material";
import type { PublishedSeriesResult } from "@/features/library-discovery";
import { getQueryClient } from "@/shared/api/query-client";
import { productOnlyOffer } from "@/storybook/billing.fixtures";
import { fetchBeforeRender } from "@/storybook/mutation-mock";
import { seriesJourneyCorpus } from "@/storybook/series-journey-corpus.fixtures";
import { Button } from "@/shared/ui/button";
import { ProductProgrammeView } from "./product-programme-view";
import {
  SeriesLearningProvider,
  SeriesLearningSource,
  type SeriesLearningView,
} from "./series-learning.client";
import { publicPageEnvironment } from "@/storybook/story-environment";

const titles = [
  "От идеи к первой версии",
  "Границы продукта",
  "Сценарии пользователя",
  "Модель предметной области",
  "Выбор технической основы",
  "Первый вертикальный срез",
  "Хранение данных",
  "Миграции без потери данных",
  "Вход и сессии",
  "Права доступа",
  "Контракты API",
  "Проверки приложения",
  "Настройка CI",
  "Сборка образа",
  "Секреты и конфигурация",
  "Подготовка сервера",
  "Первый деплой",
  "Обновление приложения",
  "Логи и диагностика",
  "Метрики и оповещения",
  "Резервное копирование",
  "Восстановление после сбоя",
  "Проверка под нагрузкой",
  "Что улучшать дальше",
];
const materials = titles.map((title, index): MaterialPreview => ({
  materialId: `series-material-${String(index + 1)}`,
  slug: `series-material-${String(index + 1)}`,
  title,
  access: index < 3 ? "free" : "closed",
  availability: "available",
  format: index % 3 === 0 ? "Видео" : "Гайд",
  formatSlug: index % 3 === 0 ? "video" : "guide",
  ...(index % 3 === 0
    ? { primaryVideoDurationSeconds: 1260 + index * 10 }
    : {}),
  summary: "",
  topic: "Platform",
  topicSlug: "platform",
  tags: [],
  seriesMemberships: [
    {
      name: "Создание Platform Inside",
      slug: "platform-inside",
      ordinal: index + 1,
    },
  ],
}));
const result = {
  chapters: [],
  discoveryKind: "series",
  kind: "ready",
  hasNext: false,
  reference: {
    name: "Создание Platform Inside",
    slug: "platform-inside",
    summary: "От продуктовой идеи до работающего приложения.",
  },
  items: materials,
  relatedSeries: [],
  topics: [],
} satisfies PublishedSeriesResult;
const chapterTitles = [
  "Основа продукта",
  "Данные и доступ",
  "Проверки и релизы",
  "Эксплуатация",
  "Что дальше",
];
const chapters = chapterTitles.map((name, index) => ({
  id: `chapter-${String(index + 1)}`,
  name,
  summary: `Что разбираем в главе «${name}» и что после неё останется в проекте.`,
  materialIds: materials
    .slice(index * 6, index * 6 + 6)
    .map(({ materialId }) => materialId ?? ""),
}));
const chapteredResult = { ...result, chapters } satisfies PublishedSeriesResult;
const resume = {
  materialSlug: "series-material-13",
  label: "Продолжить с 12:40",
};
const register = () => () => undefined;
const refresh = () => Promise.resolve();
const environment = publicPageEnvironment(
  "/products/platform-inside/programme",
);
/** Прогресс читателя: история передаёт его программе контекстом, а не свойством. */
type ProgrammeStoryArgs = ComponentProps<typeof ProductProgrammeView> & {
  readonly learning?: SeriesLearningView;
};
/**
 * Видимые на экране элементы: у строки урока метка «Бесплатно» есть и для телефона, и для
 * широкого экрана, а показывается одна из них.
 */
function visible(elements: readonly HTMLElement[]): readonly HTMLElement[] {
  // Строка формата на телефоне — текст для скринридера: она проходит checkVisibility, но
  // сама занимает 1 px.
  return elements.filter((element) => {
    const box = (
      element.closest("[data-series-meta]") ?? element
    ).getBoundingClientRect();
    return element.checkVisibility() && box.width > 1;
  });
}

/**
 * Раздел программы открывается тем, что видно на экране: колонкой разделов на широком экране или
 * нижней панелью продукта на телефоне.
 */
async function openPart(
  canvasElement: HTMLElement,
  name: RegExp,
): Promise<void> {
  await userEvent.click(partButton(canvasElement, name));
}

/** Пункт раздела в видимой навигации: колонке на широком экране или нижней панели телефона. */
function partButton(canvasElement: HTMLElement, name: RegExp): HTMLElement {
  return within(
    within(canvasElement).getByRole("navigation", { name: "Разделы продукта" }),
  ).getByRole("button", { name });
}

const meta = {
  ...environment,
  component: ProductProgrammeView,
  title: "Pages/Product/Programme",
  parameters: {
    ...environment.parameters,
    docs: {
      description: {
        component:
          "Страница программы продукта. Учебный состав из 24 материалов проверяет прогресс, непрерывный список, продолжение и состояния доступа; редакционных и провайдерских утверждений в нём нет.",
      },
    },
  },
  args: {
    result,
    learning: { kind: "ready", read: 8, total: 24, continuation: resume },
  },
  // Прогресс приходит в программу контекстом, как от `SeriesLearningSource` на маршруте.
  render: ({ learning, ...args }) => (
    <SeriesLearningProvider learning={learning ?? { kind: "guest" }}>
      <ProductProgrammeView {...args} />
    </SeriesLearningProvider>
  ),
  decorators: [
    (Story, context) => {
      const view = context.args.learning;
      const read = view?.kind === "ready" ? view.read : 0;
      const states = new Map(
        materials
          .slice(0, read)
          .map((item) => [item.materialId ?? "", { isRead: true, version: 1 }]),
      );
      return (
        <MaterialReadingScope
          value={{
            accountId: view?.kind === "guest" ? null : "story-account",
            resolved: true,
            states,
            register,
            refresh,
            failed: false,
          }}
        >
          <Story />
        </MaterialReadingScope>
      );
    },
    ...environment.decorators,
  ],
} satisfies Meta<ProgrammeStoryArgs>;
export default meta;
type Story = StoryObj<typeof meta>;

export const InProgress: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvasElement.querySelectorAll("[data-series-ordinal]"),
    ).toHaveLength(24);
    await expect(
      canvas.queryByRole("button", { name: "Показать в маршруте" }),
    ).not.toBeInTheDocument();
    await expect(
      canvas.queryByRole("navigation", { name: "Страницы маршрута" }),
    ).not.toBeInTheDocument();
    await expect(
      canvas.getByText("Показано 24 из 24 материалов"),
    ).toBeVisible();
    await expect(
      canvasElement.querySelector('[data-series-ordinal="13"]'),
    ).toHaveAttribute("aria-current", "step");
    await expect(
      canvas.getAllByRole("link", { name: "Настройка CI" })[0],
    ).toHaveAttribute(
      "href",
      expect.stringContaining("page%3D2%26at%3Dseries-material-13"),
    );
    await expect(
      canvas.getByRole("img", { name: "Материал 1, изучен" }),
    ).toBeVisible();
    await expect(
      canvasElement.querySelector('[data-series-marker-read="true"] svg'),
    ).toBeInTheDocument();
  },
};
export const Mobile: Story = {
  globals: { viewport: { value: "mobile390", isRotated: false } },
};
const lockedResult = {
  ...result,
  items: materials.map((material, index) => ({
    ...material,
    availability: index < 3 ? ("available" as const) : ("locked" as const),
  })),
};
export const Guest: Story = {
  args: { result: lockedResult, learning: { kind: "guest" } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // Открытость показывает замок у закрытых уроков, метки «Бесплатно» в строках нет.
    await expect(canvas.queryAllByText("Бесплатно")).toHaveLength(0);
    await expect(
      canvasElement.querySelectorAll('[data-material-availability="locked"]'),
    ).toHaveLength(9);
    await expect(
      canvas.getByRole("link", { name: "Модель предметной области" }),
    ).toBeVisible();
  },
};
export const LockedSeriesOffersSubscription: Story = {
  args: {
    result: lockedResult,
    learning: { kind: "guest" },
    subscriptionOffered: true,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // Витрина возвращает человека в программу, откуда он ушёл, а не на страницу продукта.
    await expect(
      canvas.getByRole("link", { name: "Посмотреть тарифы" }),
    ).toHaveAttribute(
      "href",
      "/payment/checkout?from=%2Fproducts%2Fplatform-inside%2Fprogramme",
    );
  },
};
export const LockedSeriesInvitesPayment: Story = {
  args: {
    result: lockedResult,
    learning: { kind: "guest" },
    productOffer: productOnlyOffer,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // Приглашение, а не цена: сумму и состав показывает страница оплаты.
    await expect(
      canvas.getByRole("link", { name: "Оплатить сейчас" }),
    ).toHaveAttribute("href", "/products/platform-inside/buy");
    await expect(canvas.queryByText(/2\s?500/u)).not.toBeInTheDocument();
    await expect(
      canvas.queryByRole("link", { name: "Посмотреть тарифы" }),
    ).not.toBeInTheDocument();
  },
};
export const PaymentInviteMobile: Story = {
  args: {
    result: lockedResult,
    learning: { kind: "guest" },
    productOffer: productOnlyOffer,
  },
  globals: { viewport: { value: "mobile390", isRotated: false } },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByRole("link", { name: "Оплатить сейчас" }),
    ).toBeVisible();
  },
};
export const SubscriptionNotForSaleHidesInvite: Story = {
  args: {
    result: lockedResult,
    learning: { kind: "guest" },
    subscriptionOffered: false,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // Выключенную продажу нельзя предлагать: без своей цены программа молчит про оплату.
    await expect(
      canvas.queryByRole("link", { name: "Посмотреть тарифы" }),
    ).not.toBeInTheDocument();
    await expect(
      canvas.queryByRole("link", { name: "Оплатить сейчас" }),
    ).not.toBeInTheDocument();
    await expect(
      canvas.getByRole("link", { name: "Модель предметной области" }),
    ).toBeVisible();
  },
};
export const OpenSeriesHidesPayment: Story = {
  args: { productOffer: productOnlyOffer },
  play: async ({ canvasElement }) => {
    // Право уже открыто: предлагать покупку нечего, даже когда цена заведена.
    await expect(
      within(canvasElement).queryByRole("link", { name: "Оплатить сейчас" }),
    ).not.toBeInTheDocument();
  },
};
export const OpenSeriesHidesSubscription: Story = {
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).queryByRole("link", { name: "Посмотреть тарифы" }),
    ).not.toBeInTheDocument();
  },
};
export const FreeAccount: Story = {
  args: {
    result: lockedResult,
    learning: {
      kind: "ready",
      read: 2,
      total: 24,
      continuation: {
        materialSlug: "series-material-3",
        label: "Продолжить здесь",
      },
    },
  },
};
export const ExpiredMembership: Story = {
  args: {
    result: lockedResult,
    learning: { kind: "ready", read: 8, total: 24, continuation: null },
  },
};
export const Completed: Story = {
  args: {
    learning: { kind: "ready", read: 24, total: 24, continuation: null },
  },
};
// Ошибка прогресса не закрывает материалы программы.
export const ProgressUnavailable: Story = {
  args: { learning: { kind: "unavailable" } },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByRole("list", { name: "Материалы продукта" }),
    ).toBeVisible();
  },
};
export const Loading: Story = { args: { learning: { kind: "loading" } } };
export const AccessUnavailable: Story = {
  args: {
    result: {
      ...result,
      items: materials.map((material) => ({
        ...material,
        availability: "unavailable",
      })),
    },
    learning: { kind: "ready", read: 8, total: 24, continuation: null },
  },
};
export const Chapters: Story = {
  args: { result: chapteredResult },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.queryByRole("heading", { name: "Программа продукта" }),
    ).not.toBeInTheDocument();
    const sections = canvas.getByRole("navigation", {
      name: "Разделы продукта",
    });
    await expect(sections).toBeVisible();
    await expect(within(sections).getAllByRole("button")).toHaveLength(3);
    await expect(
      canvas.getByRole("heading", { level: 3, name: "Основа продукта" }),
    ).toBeVisible();
    await expect(
      canvas
        .getByRole("list", { name: "Материалы главы «Основа продукта»" })
        .querySelectorAll("li"),
    ).toHaveLength(6);
    await expect(
      canvas.getByRole("list", { name: "Материалы главы «Основа продукта»" }),
    ).toBeVisible();
    await expect(
      canvas.getByRole("list", { name: "Материалы главы «Данные и доступ»" }),
    ).toBeVisible();
    await expect(
      canvas.getByRole("heading", { level: 3, name: "Что дальше" }),
    ).toBeVisible();
    await expect(canvas.getByText("Планируется")).toBeVisible();
  },
};
export const ChaptersMobile: Story = {
  args: { result: chapteredResult },
  globals: { viewport: { value: "mobile390", isRotated: false } },
};
/**
 * Задания глав стоят в авторском порядке среди материалов (#947, вариант 2 от 05.10.2026): без
 * привязки — в начале главы, с привязкой — сразу после своего урока. Номера уроков не сдвигаются.
 */
const taskedChapters = chapters.map((chapter, index) =>
  index === 0
    ? {
        ...chapter,
        tasks: [
          {
            code: "platform-spec",
            title: "Спецификация первой версии",
            access: "free" as const,
            afterMaterialId: null,
            availability: "available" as const,
            lastSubmittedAt: "2026-10-03T08:15:00.000Z",
          },
          {
            code: "vertical-slice",
            title: "Первый вертикальный срез",
            access: "closed" as const,
            afterMaterialId: chapter.materialIds[2] ?? null,
            availability: "available" as const,
            lastSubmittedAt: null,
          },
        ],
      }
    : index === 1
      ? {
          ...chapter,
          tasks: [
            {
              code: "access-model",
              title: "Модель доступа",
              access: "closed" as const,
              afterMaterialId: chapter.materialIds[5] ?? null,
              availability: "locked" as const,
              lastSubmittedAt: null,
            },
          ],
        }
      : chapter,
);
export const ChapterTasks: Story = {
  args: { result: { ...result, chapters: taskedChapters } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvasElement.querySelectorAll("[data-series-ordinal]"),
    ).toHaveLength(24);
    const opening = canvas.getByRole("list", {
      name: "Задания главы «Основа продукта»",
    });
    await expect(within(opening).getByText("Сдано 3 октября")).toBeVisible();
    const afterThird = canvas.getByRole("list", {
      name: "Задания после урока «Сценарии пользователя»",
    });
    await expect(
      within(afterThird).getByRole("link", {
        name: "Первый вертикальный срез",
      }),
    ).toHaveAttribute("href", "/products/platform-inside/tasks/vertical-slice");
    await expect(
      canvasElement.querySelector('[data-programme-task="access-model"]'),
    ).toHaveAttribute("data-task-availability", "locked");
    await expect(canvas.getByText("6 материалов · 2 задания")).toBeVisible();
  },
};
export const ChapterTasksMobile: Story = {
  args: { result: { ...result, chapters: taskedChapters } },
  globals: { viewport: { value: "mobile390", isRotated: false } },
};
export const PartiallyGrouped: Story = {
  args: {
    learning: { kind: "guest" },
    result: {
      ...result,
      chapters: chapters.map((chapter, index) =>
        index === 0
          ? { ...chapter, materialIds: chapter.materialIds.slice(0, 5) }
          : chapter,
      ),
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const programme = partButton(canvasElement, /Программа/u);
    await expect(programme).toHaveAttribute("aria-current", "true");
    await expect(
      canvas.queryByRole("list", { name: "Материалы продукта" }),
    ).not.toBeInTheDocument();
    await openPart(canvasElement, /^Материалы/u);
    // Каталог показывает все материалы порциями; фильтр ищет по полному составу.
    const catalog = canvas.getByRole("list", { name: "Материалы курса" });
    await expect(within(catalog).getAllByRole("listitem")).toHaveLength(12);
    await userEvent.click(
      canvas.getByRole("button", { name: "Показать ещё материалы" }),
    );
    await expect(within(catalog).getAllByRole("listitem")).toHaveLength(24);
    await userEvent.click(
      canvas.getByRole("button", { name: "Дополнительные" }),
    );
    await expect(
      within(
        canvas.getByRole("list", { name: "Материалы курса" }),
      ).getAllByRole("listitem"),
    ).toHaveLength(1);
    await expect(
      canvas.queryByRole("heading", { level: 3, name: "Основа продукта" }),
    ).not.toBeInTheDocument();
  },
};

export const LargeMaterialCatalogue: Story = {
  args: { learning: { kind: "guest" }, result: seriesJourneyCorpus() },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await openPart(canvasElement, /^Материалы/u);
    const catalogue = () =>
      canvas.getByRole("list", { name: "Материалы курса" });
    await expect(within(catalogue()).getAllByRole("listitem")).toHaveLength(12);
    await expect(
      canvas.getByText("120 материалов", { exact: true }),
    ).toBeVisible();
    const search = canvas.getByRole("searchbox", {
      name: "Поиск по материалам курса",
    });
    // Совпадение находится в последней порции, которую ещё не открывали.
    await userEvent.type(search, "Описание материала 120");
    await expect(within(catalogue()).getAllByRole("listitem")).toHaveLength(1);
    await expect(
      within(catalogue()).getByRole("heading", { name: "Урок 120" }),
    ).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Видео" }));
    await expect(canvas.getByText(/Ничего не нашлось/u)).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Гайды" }));
    await expect(
      canvas.getByRole("heading", { name: "Урок 120" }),
    ).toBeVisible();
    await userEvent.clear(search);
    await expect(within(catalogue()).getAllByRole("listitem")).toHaveLength(12);
    await userEvent.click(
      canvas.getByRole("button", { name: "Показать ещё материалы" }),
    );
    await expect(within(catalogue()).getAllByRole("listitem")).toHaveLength(24);
  },
};

export const LargeMaterialCatalogueMobile: Story = {
  ...LargeMaterialCatalogue,
  globals: { viewport: { value: "mobile390", isRotated: false } },
};

/** Серверное обновление состава после возврата из Reader; page markup остаётся production-owned. */
function CatalogueRefresh() {
  const [initial] = useState(seriesJourneyCorpus);
  const [updated, setUpdated] = useState(false);
  const first = initial.items[0];
  if (first === undefined) throw new Error("Missing catalogue fixture");
  const next = {
    ...first,
    materialId: "material-121",
    slug: "material-121",
    title: "Новый материал",
    publishedAt: "2026-10-02T12:00:00.000Z",
  };
  return (
    <>
      <ProductProgrammeView
        result={
          updated ? { ...initial, items: [...initial.items, next] } : initial
        }
      />
      <Button
        onClick={() => {
          setUpdated(true);
        }}
      >
        Получить новый состав
      </Button>
    </>
  );
}

export const CatalogueRefreshRestoresMaterial: Story = {
  args: { learning: { kind: "guest" } },
  beforeEach: () => {
    const cleanup = environment.beforeEach();
    mocked(useSearchParams).mockReturnValue(
      new ReadonlyURLSearchParams("part=materials&at=material-12"),
    );
    return () => {
      mocked(useSearchParams).mockReturnValue(new ReadonlyURLSearchParams());
      cleanup?.();
    };
  },
  render: () => <CatalogueRefresh />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const catalogue = canvas.getByRole("list", { name: "Материалы курса" });
    await expect(within(catalogue).getAllByRole("listitem")).toHaveLength(12);
    await expect(
      within(catalogue).getByRole("heading", { name: "Урок 12" }),
    ).toBeInTheDocument();
    await userEvent.click(
      canvas.getByRole("button", { name: "Получить новый состав" }),
    );
    await expect(within(catalogue).getAllByRole("listitem")).toHaveLength(24);
    await expect(
      within(catalogue).getByRole("heading", { name: "Урок 12" }),
    ).toBeInTheDocument();
  },
};
export const PartSwitchStartsAtBeginning: Story = {
  args: {
    learning: { kind: "guest" },
    result: {
      ...result,
      chapters: chapters.map((chapter, index) =>
        index === 0
          ? { ...chapter, materialIds: chapter.materialIds.slice(0, 5) }
          : chapter,
      ),
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      canvas.getByRole("button", { name: "Показать ещё уроки" }),
    );
    await expect(
      canvas.getByText("Показано 23 из 23 материалов"),
    ).toBeVisible();
    await openPart(canvasElement, /^Материалы/u);
    await expect(
      canvas.queryByRole("navigation", { name: "Страницы маршрута" }),
    ).not.toBeInTheDocument();
    await userEvent.click(
      canvas.getByRole("button", { name: "Дополнительные" }),
    );
    await expect(
      within(
        canvas.getByRole("list", { name: "Материалы курса" }),
      ).getAllByRole("listitem"),
    ).toHaveLength(1);
    await openPart(canvasElement, /Программа/u);
    await expect(
      canvas.getByText("Показано 12 из 23 материалов"),
    ).toBeVisible();
  },
};

export const OnlyPlannedChapters: Story = {
  args: {
    learning: { kind: "guest" },
    result: {
      chapters: chapters.map((chapter) => ({ ...chapter, materialIds: [] })),
      discoveryKind: "series",
      kind: "empty",
      reference: result.reference,
      relatedSeries: [],
      topics: [],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getAllByText("Планируется")).toHaveLength(5);
    await expect(
      canvas.getByRole("heading", { level: 3, name: "Основа продукта" }),
    ).toBeVisible();
    const sections = canvas.getByRole("navigation", {
      name: "Разделы продукта",
    });
    await expect(sections).toBeVisible();
    await expect(within(sections).getAllByRole("button")).toHaveLength(3);
  },
};

export const ShortSeries: Story = {
  args: {
    result: { ...result, items: materials.slice(0, 2) },
    learning: { kind: "ready", read: 0, total: 2, continuation: null },
  },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).queryByRole("navigation", {
        name: "Страницы маршрута",
      }),
    ).not.toBeInTheDocument();
  },
};

const progressResume = { ...resume, materialSlug: "series-material-2" };

/** Ответ прогресса ждёт, пока проверка не измерит программу без него. */
let deliverProgress: () => void = () => undefined;

/**
 * Прогресс вошедшего читателя, как в `PersonalSeries`: программу рисует сервер, прогресс
 * спрашивает браузер. Ответ BFF держится открытым, пока проверка его не отпустит.
 */
function heldProgress() {
  const delivered = new Promise<void>((resolve) => {
    deliverProgress = resolve;
  });
  getQueryClient().removeQueries({ queryKey: ["reading-progress"] });
  return fetchBeforeRender(async () => {
    await delivered;
    return new Response(
      JSON.stringify({
        kind: "ready",
        read: 8,
        total: 24,
        continuation: progressResume,
      }),
      { headers: { "content-type": "application/json" }, status: 200 },
    );
  })();
}

function ProgressResolution({ longTitle = false }: { longTitle?: boolean }) {
  return (
    <SeriesLearningSource
      initialAccountId="story-account"
      purchaseRowShown={false}
      slug={result.reference.slug}
    >
      <ProductProgrammeView
        result={
          longTitle
            ? {
                ...result,
                items: materials.map((item) =>
                  item.slug === progressResume.materialSlug
                    ? {
                        ...item,
                        title: "Настройка непрерывной интеграции приложения",
                      }
                    : item,
                ),
              }
            : result
        }
      />
    </SeriesLearningSource>
  );
}
export const LoadingPreservesRoutePosition: Story = {
  beforeEach: heldProgress,
  render: () => <ProgressResolution />,
  globals: { viewport: { value: "mobile390", isRotated: false } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const currentCard = canvasElement.querySelector<HTMLElement>(
      `[data-route-material="${progressResume.materialSlug}"] article`,
    );
    const nextLesson = canvasElement.querySelector<HTMLElement>(
      '[data-route-material="series-material-3"]',
    );
    if (currentCard === null || nextLesson === null)
      throw new Error("Missing continuation or following lesson");
    const currentTop = currentCard.getBoundingClientRect().top;
    const top = canvas
      .getByRole("list", { name: "Материалы продукта" })
      .getBoundingClientRect().top;
    // Шапка резервирует место для прогресса, чтобы маршрут не прыгал после загрузки.
    deliverProgress();
    await waitFor(() =>
      expect(
        within(currentCard).getByText("Продолжить", { exact: true }),
      ).toBeVisible(),
    );
    await expect(
      Math.abs(
        canvas
          .getByRole("list", { name: "Материалы продукта" })
          .getBoundingClientRect().top - top,
      ),
    ).toBeLessThan(1);
    await expect(
      within(currentCard).getByText("Продолжить", { exact: true }),
    ).toBeVisible();
    // Строка продолжения раскрывается кнопкой (решение владельца 09.10.2026): сама она и всё выше
    // неё стоят на месте, уроки ниже сдвигаются на высоту кнопки.
    await expect(
      Math.abs(currentCard.getBoundingClientRect().top - currentTop),
    ).toBeLessThan(1);
    await expect(nextLesson.getBoundingClientRect().top).toBeGreaterThan(
      currentCard.getBoundingClientRect().bottom - 1,
    );
  },
};
export const DesktopLoadingPreservesRoutePosition: Story = {
  ...LoadingPreservesRoutePosition,
  globals: { viewport: { value: "desktop1440", isRotated: false } },
};
export const TabletLoadingPreservesRoutePosition: Story = {
  ...LoadingPreservesRoutePosition,
  render: () => <ProgressResolution longTitle />,
  parameters: {
    viewport: {
      options: {
        tablet768: {
          name: "Tablet 768",
          styles: { width: "768px", height: "1024px" },
          type: "tablet",
        },
      },
    },
  },
  globals: { viewport: { value: "tablet768", isRotated: false } },
};
export const EnlargedText: Story = {
  args: { learning: { kind: "unavailable" } },
  globals: { viewport: { value: "mobile320", isRotated: false } },
  play: async ({ canvasElement }) => {
    const root = canvasElement.ownerDocument.documentElement;
    const fontSize = root.style.fontSize;
    try {
      root.style.fontSize = "200%";
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          resolve();
        });
      });
      await expect(root.scrollWidth).toBeLessThanOrEqual(root.clientWidth);
    } finally {
      root.style.fontSize = fontSize;
    }
  },
};

export const EnlargedTextInProgress: Story = { ...EnlargedText, args: {} };
export const EnlargedTextGuest: Story = {
  ...EnlargedText,
  args: Guest.args ?? {},
};

const videoSummary =
  "Разбираем путь от коммита до работающего сервиса: сборку, публикацию и откат.";
const compactRouteResult = {
  ...result,
  items: materials.slice(0, 3).map((material, index) => ({
    ...material,
    title: index === 0 ? "Как устроен релиз моего проекта" : material.title,
    summary: index === 0 ? videoSummary : "",
    cover: {
      coverId: "27100000-0000-4000-8000-000000000005",
      renditions: [{ width: 960, height: 540 }],
    },
    ...(index === 2
      ? { access: "closed" as const, availability: "locked" as const }
      : {}),
  })),
};
const compactRouteArgs = {
  result: compactRouteResult,
  learning: {
    kind: "ready",
    read: 1,
    total: 3,
    continuation: {
      materialSlug: "series-material-2",
      label: "Продолжить здесь",
    },
  },
} satisfies Story["args"];

export const CompactMobileRoute: Story = {
  args: compactRouteArgs,
  globals: { viewport: { value: "mobile390", isRotated: false } },
  play: async ({ canvasElement }) => {
    const route = within(canvasElement).getByRole("list", {
      name: "Материалы продукта",
    });
    const rows = within(route);
    await expect(rows.queryByText(videoSummary)).not.toBeInTheDocument();
    await expect(rows.queryByText("Продолжить здесь")).not.toBeInTheDocument();
    await expect(rows.queryByText("Platform")).not.toBeInTheDocument();
    await expect(
      rows.getByRole("link", { name: "Как устроен релиз моего проекта" }),
    ).toHaveAttribute("href", expect.stringContaining("series-material-1"));
    await expect(rows.queryByText("Просмотрено")).not.toBeInTheDocument();
    await expect(rows.queryAllByText("Бесплатно")).toHaveLength(0);
    await expect(
      visible([
        ...canvasElement.querySelectorAll<HTMLElement>("[data-series-format]"),
      ]),
    ).not.toHaveLength(0);
    await expect(rows.queryByText("По подписке")).not.toBeInTheDocument();
    await expect(rows.getByText("Продолжить", { exact: true })).toBeVisible();
    await expect(
      rows.getByRole("img", { name: "Материал 1, изучен" }),
    ).toBeVisible();
    await expect(
      route.querySelector('[data-material-availability="locked"]'),
    ).toHaveTextContent("Нужен доступ");
    // На телефоне длительность в строке не показывается: место отдано названию.
    await expect(
      route.querySelector("[data-series-duration]"),
    ).toHaveTextContent("21:00");
    await expect(
      route.querySelector('[data-series-ordinal="2"]'),
    ).toHaveAttribute("aria-current", "step");
    for (const card of route.querySelectorAll("article"))
      await expect(card.getBoundingClientRect().height).toBeLessThan(130);
  },
};

export const DesktopRouteDetails: Story = {
  args: compactRouteArgs,
  globals: { viewport: { value: "desktop1440", isRotated: false } },
  play: async ({ canvasElement }) => {
    const route = within(
      within(canvasElement).getByRole("list", { name: "Материалы продукта" }),
    );
    await expect(route.queryByText(videoSummary)).not.toBeInTheDocument();
    await expect(route.queryByText("Продолжить здесь")).not.toBeInTheDocument();
    await expect(route.queryByText("Platform")).not.toBeInTheDocument();
    await expect(route.queryAllByText("Бесплатно")).toHaveLength(0);
    await expect(route.getByText("Продолжить", { exact: true })).toBeVisible();
    const cards = [
      ...canvasElement.querySelectorAll<HTMLElement>(
        "[data-material-variant=series]",
      ),
    ];
    const heights = cards.map((card) => card.getBoundingClientRect().height);
    await expect(cards).toHaveLength(3);
    await expect(Math.max(...heights)).toBeLessThanOrEqual(144);
    const card = cards[2];
    const title = card?.querySelector("h3,h4");
    const preview = card?.querySelector("[data-series-preview]");
    if (!card || !title || !preview)
      throw new Error("Missing compact row geometry");
    const center = (element: Element) => {
      const box = element.getBoundingClientRect();
      return box.top + box.height / 2;
    };
    // По центру строки стоит текстовый блок: название и строка формата под ним.
    const text = title.parentElement ?? title;
    await expect(Math.abs(center(text) - center(card))).toBeLessThan(1);
    // Номер урока — мелкая цифра у первой строки названия, без плитки и обложки.
    await expect(
      Math.abs(
        preview.getBoundingClientRect().top - title.getBoundingClientRect().top,
      ),
    ).toBeLessThan(2);
    await expect(preview.getBoundingClientRect().width).toBeLessThanOrEqual(28);
    await expect(preview).toHaveTextContent(/^0?3$/u);
    for (const cover of canvasElement.querySelectorAll(
      "article .public-cover-grid",
    )) {
      const box = cover.getBoundingClientRect();
      await expect(box.width / box.height).toBeCloseTo(1, 1);
    }
    await expect(
      canvasElement
        .querySelector("[data-product-programme]")
        ?.getBoundingClientRect().width,
    ).toBeLessThanOrEqual(960);
  },
};

export const CompactMobileEnlargedText: Story = {
  ...CompactMobileRoute,
  globals: { viewport: { value: "mobile320", isRotated: false } },
  play: async ({ canvasElement }) => {
    const root = canvasElement.ownerDocument.documentElement;
    const fontSize = root.style.fontSize;
    try {
      root.style.fontSize = "200%";
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          resolve();
        });
      });
      await expect(root.scrollWidth).toBeLessThanOrEqual(root.clientWidth);
      await expect(
        canvasElement.querySelector('[data-material-availability="locked"]'),
      ).toBeVisible();
      // На телефоне длительность уступает место названию; тип урока виден всегда.
      await expect(
        canvasElement.querySelector("[data-series-format]"),
      ).toBeVisible();
    } finally {
      root.style.fontSize = fontSize;
    }
  },
};

const productId = "97000000-0000-4000-8000-000000000101";
const introduction = {
  audience:
    "Разработчики из России и СНГ с базовым знанием Git, которые хотят запускать и обслуживать своё приложение.",
  outcome:
    "Различать CI, релиз и деплой; настроить путь своего проекта от проверок до подтверждённого обновления A → B в тестовом окружении.",
  prerequisites:
    "Базовый Git, умение открыть папку проекта и выполнить команду в терминале. Docker и серверные понятия объясняются по ходу.",
  scope:
    "Один проект и один тестовый сервер. Наблюдение за работой приложения и регулярное обслуживание продакшена пока находятся в плане.",
};
const artifacts = [
  {
    artifactId: "97000000-0000-4000-8000-000000000201",
    availability: "available" as const,
    content: {
      contentType: "application/x-yaml",
      filename: "compose.production.yaml",
      kind: "file" as const,
      size: 4096,
    },
    purpose:
      "Готовый Compose для проверки опубликованного релиза на своём сервере.",
    title: "Пример продакшен-Compose",
    updatedAt: "2026-09-01T10:00:00.000Z",
    version: 3,
  },
  {
    artifactId: "97000000-0000-4000-8000-000000000202",
    availability: "locked" as const,
    content: { externalUrl: null, kind: "link" as const },
    purpose:
      "Таблица решений: где размещать приложение и во что это обходится.",
    title: "Матрица выбора инфраструктуры",
    updatedAt: "2026-08-20T10:00:00.000Z",
    version: 1,
  },
];
const productResult = {
  ...result,
  chapters,
  reference: { ...result.reference, id: productId, introduction },
} satisfies PublishedSeriesResult;

export const ProductPage: Story = {
  args: {
    artifacts: { artifacts, kind: "ready" },
    learning: { kind: "guest" },
    result: productResult,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // Описания руководства принадлежат странице продукта: программа их не повторяет.
    await expect(
      canvas.queryByText(introduction.outcome),
    ).not.toBeInTheDocument();
    await openPart(canvasElement, /Артефакты/u);
    const section = within(
      canvas.getByRole("list", { name: "Артефакты продукта" }),
    );
    await expect(
      section.getByRole("link", { name: "Скачать" }),
    ).toHaveAttribute(
      "href",
      `/api/products/${productId}/artifacts/${artifacts[0]?.artifactId ?? ""}/file?version=3`,
    );
    await expect(
      section.getByText("compose.production.yaml · 4.0 КБ"),
    ).toBeVisible();
    await expect(section.getByText("Откроется с доступом")).toBeVisible();
    await expect(
      section.queryByRole("link", { name: "Открыть" }),
    ).not.toBeInTheDocument();
    await expect(
      canvas.queryByRole("navigation", { name: "Страницы маршрута" }),
    ).not.toBeInTheDocument();
  },
};

export const ProductPageMobile: Story = {
  ...ProductPage,
  globals: { viewport: { isRotated: false, value: "mobile390" } },
};

export const ArtifactSectionUnavailable: Story = {
  args: {
    artifacts: { kind: "unavailable" },
    learning: { kind: "guest" },
    result: productResult,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole("heading", { level: 3, name: "Основа продукта" }),
    ).toBeVisible();
    await openPart(canvasElement, /Артефакты/u);
    await expect(canvas.getByRole("status")).toHaveTextContent(
      "Артефакты сейчас не загрузились",
    );
    await openPart(canvasElement, /Программа/u);
    await expect(
      canvas.getByRole("heading", { level: 3, name: "Основа продукта" }),
    ).toBeVisible();
  },
};

export const ProductPageEnlargedText: Story = {
  ...ProductPage,
  globals: { viewport: { isRotated: false, value: "mobile320" } },
  play: async ({ canvasElement }) => {
    const root = canvasElement.ownerDocument.documentElement;
    const fontSize = root.style.fontSize;
    try {
      root.style.fontSize = "200%";
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          resolve();
        });
      });
      await expect(root.scrollWidth).toBeLessThanOrEqual(root.clientWidth);
      // Пункты разделов не выходят за край экрана и при крупном шрифте.
      for (const tab of canvasElement.querySelectorAll<HTMLElement>(
        "[data-programme-sidebar] button, .product-bottom-bar-item",
      )) {
        await expect(tab.getBoundingClientRect().right).toBeLessThanOrEqual(
          root.clientWidth,
        );
      }
    } finally {
      root.style.fontSize = fontSize;
    }
  },
};

export const ProgrammeProgress: Story = {
  args: {
    learning: { kind: "ready", read: 8, total: 24, continuation: resume },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole("heading", { level: 1, name: result.reference.name }),
    ).toBeVisible();
    await expect(canvas.getByText("Изучено 8 из 24")).toBeVisible();
    await expect(canvas.getByText("33%")).toBeVisible();
    const progress = canvas.getByRole("progressbar", {
      name: "Прогресс продукта",
    });
    await expect(progress).toHaveAttribute("max", "24");
    await expect(progress).toHaveAttribute("value", "8");
    await openPart(canvasElement, /^Материалы/u);
    await expect(partButton(canvasElement, /^Материалы/u)).toHaveAttribute(
      "aria-current",
      "true",
    );
    await openPart(canvasElement, /Артефакты/u);
    await expect(partButton(canvasElement, /Артефакты/u)).toHaveAttribute(
      "aria-current",
      "true",
    );
    await expect(
      canvas.getByText(
        "Здесь появятся файлы, шаблоны и инструменты для работы над проектом.",
      ),
    ).toBeVisible();
  },
};

export const InfiniteScroll: Story = {
  args: { result: chapteredResult, learning: { kind: "guest" } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const first = canvasElement.querySelector(
      '[data-route-material="series-material-1"]',
    );
    await expect(
      canvasElement.querySelectorAll("[data-series-ordinal]"),
    ).toHaveLength(12);
    canvas
      .getByRole("button", { name: "Показать ещё уроки" })
      .scrollIntoView({ block: "end" });
    await waitFor(async () => {
      await expect(
        canvasElement.querySelectorAll("[data-series-ordinal]"),
      ).toHaveLength(24);
    });
    await expect(
      canvasElement.querySelector('[data-route-material="series-material-1"]'),
    ).toBe(first);
    await expect(
      canvas.queryByRole("button", { name: "Показать ещё уроки" }),
    ).not.toBeInTheDocument();
    await expect(
      canvas.getAllByRole("heading", { name: "Основа продукта" }),
    ).toHaveLength(1);
    await expect(
      canvas.getByRole("heading", { name: "Что дальше" }),
    ).toBeVisible();
  },
};

export const PartSwitchClearsContinuationPosition: Story = {
  args: {
    result: chapteredResult,
    learning: { kind: "ready", read: 8, total: 24, continuation: resume },
  },
  play: async ({ canvasElement }) => {
    await expect(
      canvasElement.querySelectorAll("[data-series-ordinal]"),
    ).toHaveLength(24);
    await openPart(canvasElement, /^Материалы/u);
    await openPart(canvasElement, /Программа/u);
    await expect(
      canvasElement.querySelectorAll("[data-series-ordinal]"),
    ).toHaveLength(12);
    await expect(
      canvasElement.querySelector('[data-series-ordinal="1"]'),
    ).toBeVisible();
  },
};

/** Продукт из видео, заметок и связанных шагов: программа не рисует номера шагов и сводки видео. */
const connectedStepsResult = {
  ...result,
  reference: {
    cover: null,
    name: "Релиз своего проекта",
    slug: "release",
    summary: "Видео, заметки и последовательные инструкции в одном продукте.",
  },
  items: [
    {
      title: "Как устроен релиз моего проекта",
      format: "Видео",
      formatSlug: "video",
      summary:
        "От коммита до работающего сервиса: сборка, конфигурация, публикация и откат релиза.",
    },
    {
      title: "Подготовка приложения",
      format: "Гайд",
      formatSlug: "guide",
      stepGroup: "От проекта до релиза",
    },
    {
      title: "Разбираем Docker на реальном примере",
      format: "Видео",
      formatSlug: "video",
      summary:
        "Собираем образ приложения, настраиваем сеть и тома Docker Compose, читаем логи при неудачном запуске.",
    },
    { title: "Памятка по секретам", format: "Заметка", formatSlug: "note" },
    {
      title: "Настройка окружения",
      format: "Гайд",
      formatSlug: "guide",
      stepGroup: "От проекта до релиза",
    },
    {
      title: "Первый деплой",
      format: "Гайд",
      formatSlug: "guide",
      stepGroup: "От проекта до релиза",
    },
  ].map((definition, index) => ({
    access: "free" as const,
    availability: "available" as const,
    tags: [],
    topic: "Platform",
    topicSlug: "platform",
    ...definition,
    slug: `release-${String(index)}`,
    summary:
      definition.summary ??
      "Материал общего продукта: изучайте в предложенном порядке или возвращайтесь к нужному шагу.",
    seriesMemberships: [
      {
        name: "Релиз своего проекта",
        slug: "release",
        ordinal: index + 1,
        stepGroup: definition.stepGroup ?? null,
      },
    ],
  })),
} satisfies PublishedSeriesResult;

const overviewVideo = connectedStepsResult.items[0];
const dockerVideo = connectedStepsResult.items[2];
if (overviewVideo === undefined || dockerVideo === undefined)
  throw new Error("Missing release video fixtures");

export const ConnectedStepsDesktop: Story = {
  args: { result: connectedStepsResult, learning: { kind: "guest" } },
  globals: { viewport: { isRotated: false, value: "desktop1440" } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByText("Шаг 1 из 3")).not.toBeInTheDocument();
    await expect(canvas.queryByText("Шаг 2 из 3")).not.toBeInTheDocument();
    await expect(canvas.queryByText("Шаг 3 из 3")).not.toBeInTheDocument();
    await expect(
      canvasElement.querySelectorAll("[data-series-ordinal]"),
    ).toHaveLength(6);
    await expect(
      canvasElement.querySelectorAll("[data-series-step]"),
    ).toHaveLength(0);
    const rows = canvasElement.querySelectorAll("[data-series-ordinal]");
    await expect(
      canvasElement.querySelectorAll("[data-series-marker]"),
    ).toHaveLength(0);
    await expect(
      canvasElement.querySelectorAll("[data-series-rail]"),
    ).toHaveLength(0);
    for (const [index, row] of [...rows].entries()) {
      await expect(row).toHaveTextContent(`Урок ${String(index + 1)}.`);
    }
    const product = canvas
      .getByRole("heading", { name: "Подготовка приложения" })
      .closest("article");
    if (product === null) throw new Error("Missing product card");
    await expect(
      within(product).queryByText("Шаг 1 из 3"),
    ).not.toBeInTheDocument();
    for (const summary of [overviewVideo.summary, dockerVideo.summary]) {
      await expect(canvas.queryByText(summary)).not.toBeInTheDocument();
    }
    const root = canvasElement.ownerDocument.documentElement;
    await expect(root.scrollWidth).toBeLessThanOrEqual(root.clientWidth);
  },
};
export const ConnectedStepsMobile: Story = {
  ...ConnectedStepsDesktop,
  globals: { viewport: { isRotated: false, value: "mobile390" } },
};

const literalSummary =
  '<img src=x onerror="alert(1)"> Команда остаётся текстом.';
export const VideoSummaryIsNotShown: Story = {
  args: {
    result: {
      ...connectedStepsResult,
      items: [{ ...overviewVideo, summary: literalSummary }],
    },
    learning: { kind: "guest" },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByText(literalSummary)).not.toBeInTheDocument();
    await expect(canvasElement.querySelector("img[onerror]")).toBeNull();
    await expect(
      canvasElement.querySelectorAll("[data-series-rail]"),
    ).toHaveLength(0);
    await expect(
      canvasElement.querySelectorAll("[data-series-step]"),
    ).toHaveLength(0);
  },
};
