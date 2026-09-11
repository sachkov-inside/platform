import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { MaterialReadingContext, type MaterialPreview } from "@/entities/material";
import type { PublishedSeriesResult } from "@/features/library-discovery";
import { guideOnlyOffer } from "@/workshop/billing.fixtures";
import { GuideProgrammeView } from "./guide-programme-view.client";
import { publicPageEnvironment } from "@/workshop/story-environment";

const titles = ["От идеи к первой версии", "Границы продукта", "Сценарии пользователя", "Модель предметной области", "Выбор технической основы", "Первый вертикальный срез", "Хранение данных", "Миграции без потери данных", "Вход и сессии", "Права доступа", "Контракты API", "Проверки приложения", "Настройка CI", "Сборка образа", "Секреты и конфигурация", "Подготовка сервера", "Первый деплой", "Обновление приложения", "Логи и диагностика", "Метрики и оповещения", "Резервное копирование", "Восстановление после сбоя", "Проверка под нагрузкой", "Что улучшать дальше"];
const materials = titles.map((title, index): MaterialPreview => ({
  materialId: `series-material-${String(index + 1)}`, slug: `series-material-${String(index + 1)}`, title,
  access: index < 3 ? "free" : "membership", availability: "available", format: index % 3 === 0 ? "Видео" : "Гайд", formatSlug: index % 3 === 0 ? "video" : "guide",
  ...(index % 3 === 0 ? { primaryVideoDurationSeconds: 1260 + index * 10 } : {}),
  summary: "", topic: "Platform", topicSlug: "platform", tags: [],
  seriesMemberships: [{ name: "Создание Platform Inside", slug: "platform-inside", ordinal: index + 1 }],
}));
const result = { chapters: [], discoveryKind: "series", kind: "ready", hasNext: false, reference: { name: "Создание Platform Inside", slug: "platform-inside", summary: "От продуктовой идеи до работающего приложения." }, items: materials, relatedSeries: [], topics: [] } satisfies PublishedSeriesResult;
const chapterTitles = ["Основа продукта", "Данные и доступ", "Проверки и релизы", "Эксплуатация", "Что дальше"];
const chapters = chapterTitles.map((name, index) => ({
  id: `chapter-${String(index + 1)}`,
  name,
  summary: `Что разбираем в главе «${name}» и что после неё останется в проекте.`,
  materialIds: materials.slice(index * 6, index * 6 + 6).map(({ materialId }) => materialId ?? ""),
}));
const chapteredResult = { ...result, chapters } satisfies PublishedSeriesResult;
const resume = { materialSlug: "series-material-13", label: "Продолжить с 12:40" };
const register = () => () => undefined;
const refresh = () => Promise.resolve();
const environment = publicPageEnvironment("/guides/platform-inside/programme");
const meta = {
  component: GuideProgrammeView,
  title: "Pages/Guide/Programme",
  ...environment,
  parameters: { ...environment.parameters, docs: { description: { component: "Страница программы руководства. Учебный состав из 24 материалов проверяет прогресс, страницы, продолжение и состояния доступа; редакционных и провайдерских утверждений в нём нет." } } },
  args: { result, learning: { kind: "ready", read: 8, total: 24, continuation: resume } },
  decorators: [(Story, context) => {
    const view = context.args.learning;
    const read = view?.kind === "ready" ? view.read : 0;
    const states = new Map(materials.slice(0, read).map((item) => [item.materialId ?? "", { isRead: true, version: 1 }]));
    return <MaterialReadingContext value={{ accountId: view?.kind === "guest" ? null : "story-account", resolved: true, states, register, refresh, failed: false }}><Story /></MaterialReadingContext>;
  }, ...environment.decorators],
} satisfies Meta<typeof GuideProgrammeView>;
export default meta;
type Story = StoryObj<typeof meta>;

export const InProgress: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvasElement.querySelectorAll("[data-series-ordinal]")).toHaveLength(12);
    await expect(canvas.queryByRole("button", { name: "Показать в маршруте" })).not.toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: "Страница 2, продолжение" })).toHaveAttribute("aria-current", "page");
    await expect(canvas.getByText("Материалы 13–24 из 24")).toBeVisible();
    await expect(canvasElement.querySelector('[data-series-ordinal="13"]')).toHaveAttribute("aria-current", "step");
    await expect(canvas.getAllByRole("link", { name: "Настройка CI" })[0]).toHaveAttribute("href", expect.stringContaining("page%3D2%26at%3Dseries-material-13"));
    await userEvent.click(canvas.getByRole("button", { name: "Страница 1" }));
    await expect(canvas.getByText("Материалы 1–12 из 24")).toBeVisible();
    await expect(canvas.getByRole("img", { name: "Материал 1, изучен" })).toBeVisible();
    await expect(canvasElement.querySelector('[data-series-marker-read="true"] svg')).toBeInTheDocument();
  },
};
export const Mobile: Story = { globals: { viewport: { value: "mobile390", isRotated: false } } };
const lockedResult = { ...result, items: materials.map((material, index) => ({ ...material, availability: index < 3 ? "available" as const : "locked" as const })) };
export const Guest: Story = {
  args: { result: lockedResult, learning: { kind: "guest" } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByText("Бесплатно")).not.toBeInTheDocument();
    await expect(canvasElement.querySelectorAll('[data-access-cover="locked"]')).toHaveLength(9);
    await expect(canvas.getByRole("link", { name: "Модель предметной области" })).toBeVisible();
  },
};
export const LockedSeriesOffersSubscription: Story = {
  args: { result: lockedResult, learning: { kind: "guest" }, subscriptionOffered: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // Контекст руководства сохраняется в ссылке, иначе после входа покупатель теряет место.
    await expect(canvas.getByRole("link", { name: "Посмотреть тарифы" })).toHaveAttribute(
      "href",
      "/subscription?from=%2Fguides%2Fplatform-inside",
    );
  },
};
export const LockedSeriesInvitesPayment: Story = {
  args: { result: lockedResult, learning: { kind: "guest" }, guideOffer: guideOnlyOffer },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // Приглашение, а не цена: сумму и состав показывает страница оплаты.
    await expect(canvas.getByRole("link", { name: "Оплатить сейчас" })).toHaveAttribute(
      "href",
      "/guides/platform-inside/buy",
    );
    await expect(canvas.queryByText(/2\s?500/u)).not.toBeInTheDocument();
    await expect(canvas.queryByRole("link", { name: "Посмотреть тарифы" })).not.toBeInTheDocument();
  },
};
export const PaymentInviteMobile: Story = {
  args: { result: lockedResult, learning: { kind: "guest" }, guideOffer: guideOnlyOffer },
  globals: { viewport: { value: "mobile390", isRotated: false } },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByRole("link", { name: "Оплатить сейчас" }),
    ).toBeVisible();
  },
};
export const SubscriptionNotForSaleHidesInvite: Story = {
  args: { result: lockedResult, learning: { kind: "guest" }, subscriptionOffered: false },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // Выключенную продажу нельзя предлагать: без своей цены программа молчит про оплату.
    await expect(canvas.queryByRole("link", { name: "Посмотреть тарифы" })).not.toBeInTheDocument();
    await expect(canvas.queryByRole("link", { name: "Оплатить сейчас" })).not.toBeInTheDocument();
    await expect(canvas.getByRole("link", { name: "Модель предметной области" })).toBeVisible();
  },
};
export const OpenSeriesHidesPayment: Story = {
  args: { guideOffer: guideOnlyOffer },
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
export const FreeAccount: Story = { args: { result: lockedResult, learning: { kind: "ready", read: 2, total: 24, continuation: { materialSlug: "series-material-3", label: "Продолжить здесь" } } } };
export const ExpiredMembership: Story = { args: { result: lockedResult, learning: { kind: "ready", read: 8, total: 24, continuation: null } } };
export const Completed: Story = { args: { learning: { kind: "ready", read: 24, total: 24, continuation: null } } };
// Прогресс не читается: маршрут всё равно открыт, а отдельной сводки над ним больше нет.
export const ProgressUnavailable: Story = { args: { learning: { kind: "unavailable" } }, play: async ({ canvasElement }) => { await expect(within(canvasElement).getByRole("list", { name: "Материалы руководства" })).toBeVisible(); } };
export const Loading: Story = { args: { learning: { kind: "loading" } } };
export const AccessUnavailable: Story = { args: { result: { ...result, items: materials.map((material) => ({ ...material, availability: "unavailable" })) }, learning: { kind: "ready", read: 8, total: 24, continuation: null } } };
export const Chapters: Story = {
  args: { result: chapteredResult },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByRole("heading", { name: "Программа руководства" })).not.toBeInTheDocument();
    await expect(canvas.queryByRole("tablist")).not.toBeInTheDocument();
    await userEvent.click(canvas.getByRole("button", { name: "Страница 1" }));
    await expect(canvas.getByRole("heading", { level: 3, name: "Основа продукта" })).toBeVisible();
    await expect(canvas.getByText("Глава 1 из 5")).toBeVisible();
    await expect(canvas.getByRole("list", { name: "Материалы главы «Основа продукта»" })).toBeVisible();
    await expect(canvas.getByRole("list", { name: "Материалы главы «Данные и доступ»" })).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: /^Страница 2/u }));
    await expect(canvas.getByRole("heading", { level: 3, name: "Что дальше" })).toBeVisible();
    await expect(canvas.getByText("Материалы готовятся")).toBeVisible();
  },
};
export const ChaptersMobile: Story = { args: { result: chapteredResult }, globals: { viewport: { value: "mobile390", isRotated: false } } };
export const PartiallyGrouped: Story = {
  args: {
    learning: { kind: "guest" },
    result: {
      ...result,
      chapters: chapters.map((chapter, index) => index === 0
        ? { ...chapter, materialIds: chapter.materialIds.slice(0, 5) }
        : chapter),
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const programme = canvas.getByRole("tab", { name: /Программа/u });
    await expect(programme).toHaveAttribute("aria-selected", "true");
    await expect(canvas.queryByRole("list", { name: "Материалы руководства" })).not.toBeInTheDocument();
    await userEvent.click(canvas.getByRole("tab", { name: /Дополнительные материалы/u }));
    const other = canvas.getByRole("list", { name: "Материалы руководства" });
    await expect(within(other).getAllByRole("listitem")).toHaveLength(1);
    await expect(canvas.queryByRole("heading", { level: 3, name: "Основа продукта" })).not.toBeInTheDocument();
  },
};
export const PartSwitchStartsAtFirstPage: Story = {
  args: {
    learning: { kind: "guest" },
    result: {
      ...result,
      chapters: chapters.map((chapter, index) => index === 0
        ? { ...chapter, materialIds: chapter.materialIds.slice(0, 5) }
        : chapter),
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: /^Страница 2/u }));
    await expect(canvas.getByText("Материалы 13–23 из 23")).toBeVisible();
    await userEvent.click(canvas.getByRole("tab", { name: /Дополнительные материалы/u }));
    await expect(canvas.queryByRole("navigation", { name: "Страницы маршрута" })).not.toBeInTheDocument();
    await expect(within(canvas.getByRole("list", { name: "Материалы руководства" })).getAllByRole("listitem")).toHaveLength(1);
    await userEvent.click(canvas.getByRole("tab", { name: /Программа/u }));
    await expect(canvas.getByText("Материалы 1–12 из 23")).toBeVisible();
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
    await expect(canvas.getAllByText("Материалы готовятся")).toHaveLength(5);
    await expect(canvas.getByRole("heading", { level: 3, name: "Основа продукта" })).toBeVisible();
    await expect(canvas.queryByRole("tablist")).not.toBeInTheDocument();
  },
};

export const ShortSeries: Story = { args: { result: { ...result, items: materials.slice(0, 2) }, learning: { kind: "ready", read: 0, total: 2, continuation: null } }, play: async ({ canvasElement }) => { await expect(within(canvasElement).queryByRole("navigation", { name: "Страницы маршрута" })).not.toBeInTheDocument(); } };

function ProgressResolution({ longTitle = false }: { longTitle?: boolean }) {
  const [ready, setReady] = useState(false);
  return <>
    <button onClick={() => { setReady(true); }} type="button">Получить прогресс (проверка)</button>
    <GuideProgrammeView result={longTitle ? { ...result, items: materials.map((item) => item.slug === resume.materialSlug ? { ...item, title: "Настройка непрерывной интеграции приложения" } : item) } : result} learning={ready ? { kind: "ready", read: 8, total: 24, continuation: resume } : { kind: "loading" }} />
  </>;
}
export const LoadingPreservesRoutePosition: Story = {
  render: () => <ProgressResolution />,
  globals: { viewport: { value: "mobile390", isRotated: false } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const top = canvas.getByRole("list", { name: "Материалы руководства" }).getBoundingClientRect().top;
    // Разрешение прогресса не двигает маршрут: сводки над ним больше нет, и сдвигаться нечему.
    await userEvent.click(canvas.getByRole("button", { name: "Получить прогресс (проверка)" }));
    await expect(Math.abs(canvas.getByRole("list", { name: "Материалы руководства" }).getBoundingClientRect().top - top)).toBeLessThan(1);
  },
};
export const DesktopLoadingPreservesRoutePosition: Story = { ...LoadingPreservesRoutePosition, globals: { viewport: { value: "desktop1440", isRotated: false } } };
export const TabletLoadingPreservesRoutePosition: Story = {
  ...LoadingPreservesRoutePosition,
  render: () => <ProgressResolution longTitle />,
  parameters: { viewport: { options: { tablet768: { name: "Tablet 768", styles: { width: "768px", height: "1024px" }, type: "tablet" } } } },
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
      await new Promise<void>((resolve) => { requestAnimationFrame(() => { resolve(); }); });
      await expect(root.scrollWidth).toBeLessThanOrEqual(root.clientWidth);
    } finally { root.style.fontSize = fontSize; }
  },
};

export const EnlargedTextInProgress: Story = { ...EnlargedText, args: {} };
export const EnlargedTextGuest: Story = { ...EnlargedText, args: Guest.args ?? {} };

const videoSummary = "Разбираем путь от коммита до работающего сервиса: сборку, публикацию и откат.";
const compactRouteResult = {
  ...result,
  items: materials.slice(0, 3).map((material, index) => ({
    ...material,
    title: index === 0 ? "Как устроен релиз моего проекта" : material.title,
    summary: index === 0 ? videoSummary : "",
    cover: { coverId: "27100000-0000-4000-8000-000000000005", renditions: [{ width: 960, height: 540 }] },
    ...(index === 2 ? { access: "membership" as const, availability: "locked" as const } : {}),
  })),
};
const compactRouteArgs = {
  result: compactRouteResult,
  learning: { kind: "ready", read: 1, total: 3, continuation: { materialSlug: "series-material-2", label: "Продолжить здесь" } },
} satisfies Story["args"];

export const CompactMobileRoute: Story = {
  args: compactRouteArgs,
  globals: { viewport: { value: "mobile390", isRotated: false } },
  play: async ({ canvasElement }) => {
    const route = within(canvasElement).getByRole("list", { name: "Материалы руководства" });
    const rows = within(route);
    await expect(rows.getByText(videoSummary)).not.toBeVisible();
    await expect(rows.queryByText("Продолжить здесь")).not.toBeInTheDocument();
    await expect(rows.queryByText("Platform")).not.toBeInTheDocument();
    await expect(rows.getByRole("link", { name: "Как устроен релиз моего проекта" })).toHaveAttribute("href", expect.stringContaining("series-material-1"));
    await expect(rows.queryByText("Просмотрено")).not.toBeInTheDocument();
    await expect(rows.queryByText(/^(Бесплатно|По подписке)$/)).not.toBeInTheDocument();
    await expect(rows.getByRole("img", { name: "Материал 1, изучен" })).toBeVisible();
    await expect(route.querySelector('[data-access-cover="locked"]')).toBeVisible();
    await expect(route.querySelector("[data-series-duration]")).toBeVisible();
    await expect(route.querySelector("[data-series-duration]")).toHaveTextContent("21:00");
    await expect(route.querySelector('[data-series-ordinal="2"]')).toHaveAttribute("aria-current", "step");
    for (const card of route.querySelectorAll("article")) await expect(card.getBoundingClientRect().height).toBeLessThan(130);
  },
};

export const DesktopRouteDetails: Story = {
  args: compactRouteArgs,
  globals: { viewport: { value: "desktop1440", isRotated: false } },
  play: async ({ canvasElement }) => {
    const route = within(within(canvasElement).getByRole("list", { name: "Материалы руководства" }));
    await expect(route.getByText(videoSummary)).toBeVisible();
    await expect(route.queryByText("Продолжить здесь")).not.toBeInTheDocument();
    await expect(route.queryByText("Platform")).not.toBeInTheDocument();
    await expect(route.queryByText("Бесплатно")).not.toBeInTheDocument();
    const cards = [...canvasElement.querySelectorAll<HTMLElement>("[data-material-variant=series]")];
    const heights = cards.map((card) => card.getBoundingClientRect().height);
    await expect(Math.max(...heights) - Math.min(...heights)).toBeLessThan(1);
    await expect(Math.max(...heights)).toBeLessThanOrEqual(144);
    for (const cover of canvasElement.querySelectorAll("article .public-cover-grid")) {
      const box = cover.getBoundingClientRect();
      await expect(box.width / box.height).toBeCloseTo(16 / 9, 1);
    }
    await expect(canvasElement.querySelector("[data-guide-programme]")?.getBoundingClientRect().width).toBeLessThanOrEqual(1040);
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
      await new Promise<void>((resolve) => { requestAnimationFrame(() => { resolve(); }); });
      await expect(root.scrollWidth).toBeLessThanOrEqual(root.clientWidth);
      await expect(canvasElement.querySelector('[data-access-cover="locked"]')).toBeVisible();
      await expect(canvasElement.querySelector("[data-series-duration]")).toBeVisible();
    } finally { root.style.fontSize = fontSize; }
  },
};

const guideId = "97000000-0000-4000-8000-000000000101";
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
    purpose: "Готовый Compose для проверки опубликованного релиза на своём сервере.",
    title: "Пример продакшен-Compose",
    updatedAt: "2026-09-01T10:00:00.000Z",
    version: 3,
  },
  {
    artifactId: "97000000-0000-4000-8000-000000000202",
    availability: "locked" as const,
    content: { externalUrl: null, kind: "link" as const },
    purpose: "Таблица решений: где размещать приложение и во что это обходится.",
    title: "Матрица выбора инфраструктуры",
    updatedAt: "2026-08-20T10:00:00.000Z",
    version: 1,
  },
];
const guideResult = {
  ...result,
  chapters,
  reference: { ...result.reference, id: guideId, introduction },
} satisfies PublishedSeriesResult;

export const GuidePage: Story = {
  args: {
    artifacts: { artifacts, kind: "ready" },
    learning: { kind: "guest" },
    result: guideResult,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // Описания руководства принадлежат странице продукта: программа их не повторяет.
    await expect(canvas.queryByText(introduction.outcome)).not.toBeInTheDocument();
    await userEvent.click(canvas.getByRole("tab", { name: /Артефакты/u }));
    const section = within(canvas.getByRole("list", { name: "Артефакты руководства" }));
    await expect(
      section.getByRole("link", { name: "Скачать" }),
    ).toHaveAttribute(
      "href",
      `/api/guides/${guideId}/artifacts/${artifacts[0]?.artifactId ?? ""}/file?version=3`,
    );
    await expect(section.getByText("compose.production.yaml · 4.0 КБ")).toBeVisible();
    await expect(section.getByText("Откроется с доступом")).toBeVisible();
    await expect(section.queryByRole("link", { name: "Открыть" })).not.toBeInTheDocument();
    await expect(canvas.queryByRole("navigation", { name: "Страницы маршрута" })).not.toBeInTheDocument();
  },
};

export const GuidePageMobile: Story = {
  ...GuidePage,
  globals: { viewport: { isRotated: false, value: "mobile390" } },
};

export const ArtifactSectionUnavailable: Story = {
  args: {
    artifacts: { kind: "unavailable" },
    learning: { kind: "guest" },
    result: guideResult,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByText("Раздел артефактов сейчас не открывается. Материалы руководства это не затрагивает."),
    ).toBeVisible();
    await expect(canvas.queryByRole("tab", { name: /Артефакты/u })).not.toBeInTheDocument();
    await expect(canvas.getByRole("heading", { level: 3, name: "Основа продукта" })).toBeVisible();
  },
};

export const GuidePageEnlargedText: Story = {
  ...GuidePage,
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
      // The part tabs are the widest new control; a long label wraps inside its pill.
      for (const tab of canvasElement.querySelectorAll<HTMLElement>('[role="tab"]')) {
        await expect(tab.getBoundingClientRect().right).toBeLessThanOrEqual(root.clientWidth);
      }
    } finally {
      root.style.fontSize = fontSize;
    }
  },
};
