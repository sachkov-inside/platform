import type { Meta, StoryObj } from "@storybook/react-vite";
import { use } from "react";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { createLibraryCatalogQueryOptions, libraryCatalogQueryKey, type LibraryCatalogPage, type LibrarySearchQuery } from "@/features/library-catalog";
import { getQueryClient } from "@/shared/api/query-client";
import { NavigationPendingFrame } from "@/widgets/application-shell";
import { publicPageEnvironment } from "@/workshop/story-environment";
import { HomePage } from "./home-page";
import { HomeFeedView } from "./home-feed.client";
import { HomeLoading } from "./home-loading";
import { aiFirstProductPage, aiFirstProductSummary } from "@/workshop/guide-page.fixtures";
import { illustratedHome } from "./illustrated-home.fixture";

const pinnedPlaylist = illustratedHome.playlists[1];
const home = { ...illustratedHome, pinnedSeries: pinnedPlaylist === undefined ? null : { ...pinnedPlaylist, presentation: "default" as const, card: null } };
const query = { after: null, q: "", sort: "newest", formatSlugs: [], topicSlug: null } as const;
const note = illustratedHome.notes[0];
if (note === undefined) throw new Error("Expected a note fixture");
const items = [
  ...illustratedHome.videos,
  { ...note, access: "free" as const, availability: "available" as const, formatSlug: "note", noteExcerpt: { text: "Маленький релиз легче проверить. Один результат, одна проверка — и понятный следующий шаг. Пример проекта — по ссылке ниже.", truncated: false, linkUrl: "https://github.com/sachkov-inside/platform" } },
  ...illustratedHome.guides,
];
const topic = (slug: string, name: string) => ({ id: `topic-${slug}`, slug, name, count: 2, summary: null });
const threeTopics = [topic("ai-agents", "AI-агенты"), topic("software-engineering", "Разработка ПО"), topic("product-development", "Разработка продукта")];
const manyTopics = [...threeTopics, topic("testing", "Тестирование"), topic("security", "Безопасность"), topic("data", "Данные"), topic("operations", "Эксплуатация")];
function readyPage(state: LibrarySearchQuery, topics = threeTopics): LibraryCatalogPage {
  return { kind: "ready", items: items.filter((item) => (state.formatSlugs.length === 0 || item.formatSlug === state.formatSlugs[0]) && item.title.toLowerCase().includes(state.q.toLowerCase())), facets: { formats: [], series: [], topics }, nextCursor: null, totalCount: items.length };
}
function feed(result?: LibraryCatalogPage, topics = threeTopics) {
  const options = (state: LibrarySearchQuery) => createLibraryCatalogQueryOptions(() => Promise.resolve(result ?? readyPage(state, topics)), state);
  return <HomeFeedView initialQuery={query} createQueryOptions={options} />;
}
const meta = { ...publicPageEnvironment("/"), component: HomePage, tags: ["autodocs"], title: "Pages/Mobile-first Platform/Home" } satisfies Meta<typeof HomePage>;
export default meta;
type Story = StoryObj<typeof meta>;

interface StoryViewport { readonly globals: { readonly viewport: { readonly value: string; readonly isRotated: false } }; readonly width: number }
const desktop: StoryViewport = { globals: { viewport: { value: "desktop1440", isRotated: false } }, width: 1440 };
const mobile: StoryViewport = { globals: { viewport: { value: "mobile390", isRotated: false } }, width: 390 };
const aiFirstPin = { id: "ai-first-guide", cover: null, previewItems: [], slug: "working-with-agents", name: "AI-first разработка", summary: aiFirstProductSummary, count: 6, presentation: "ai-first-process" as const, card: aiFirstProductPage.card };

export const RealDataReady: Story = {
  args: { result: { kind: "ready", value: home }, feed: feed() },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("link", { name: "Открыть продукт" })).toBeInTheDocument();
    await expect(canvas.getByRole("region", { name: "Материалы" })).toBeInTheDocument();
    await expect(canvas.getByRole("group", { name: "Формат материала" })).toBeInTheDocument();
    await expect(await canvas.findByRole("link", { name: "Открыть github.com в новой вкладке" })).toHaveAttribute("href", "https://github.com/sachkov-inside/platform");
    await expect(canvas.queryByText("Что даёт подписка")).not.toBeInTheDocument();
    await expect(canvas.queryByText("База знаний")).not.toBeInTheDocument();
  },
};
/** Search on its own row; formats and topics are one chip row, and a second press clears a topic. */
export const FeedFilters: Story = {
  args: { result: { kind: "ready", value: home }, feed: feed() },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole("searchbox", { name: "Поиск по материалам" })).toBeVisible();
    const topics = within(await canvas.findByRole("group", { name: "Тема" }));
    const agents = topics.getByRole("button", { name: "AI-агенты" });
    await expect(canvas.queryByRole("button", { name: "Сбросить" })).not.toBeInTheDocument();
    await userEvent.click(agents);
    await expect(agents).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(agents);
    await expect(agents).toHaveAttribute("aria-pressed", "false");
    const formats = within(canvas.getByRole("group", { name: "Формат материала" }));
    await userEvent.click(formats.getByRole("button", { name: "Видео" }));
    await userEvent.click(topics.getByRole("button", { name: "Разработка ПО" }));
    await userEvent.click(canvas.getByRole("button", { name: "Сбросить" }));
    await expect(formats.getByRole("button", { name: "Все" })).toHaveAttribute("aria-pressed", "true");
    await expect(formats.getByRole("button", { name: "Все" })).toHaveFocus();
    await expect(topics.getByRole("button", { name: "Разработка ПО" })).toHaveAttribute("aria-pressed", "false");
    await expect(canvas.queryByRole("button", { name: "Сбросить" })).not.toBeInTheDocument();
  },
};
export const FeedFiltersMobile: Story = { ...FeedFilters, globals: mobile.globals };
/** More than six topics fold into one menu with the chip shape. */
export const FeedFiltersManyTopics: Story = {
  args: { result: { kind: "ready", value: home }, feed: feed(undefined, manyTopics) },
  // Stories share one query cache and one query key; this one needs its own catalogue page.
  beforeEach: () => { getQueryClient().clear(); },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole("combobox", { name: "Тема" })).toBeVisible();
    await expect(canvas.queryByRole("group", { name: "Тема" })).not.toBeInTheDocument();
  },
};
export const EmptyFeed: Story = { args: { result: { kind: "ready", value: home }, feed: feed({ kind: "empty" }) } };
export const Unavailable: Story = {
  args: { result: { kind: "unavailable" }, feed: feed({ kind: "unavailable" }) },
  play: async ({ canvasElement }) => {
    // Сбой закрепа браузер помнит окно страницы, поэтому повтор обязан быть на экране (ADR 0027).
    const pinFailure = within(canvasElement).getByText(/Не удалось загрузить продукт/u).parentElement;
    if (pinFailure === null) throw new Error("Сообщение о сбое закрепа стоит вне своего блока");
    await expect(within(pinFailure).getByRole("button", { name: "Повторить" })).toBeVisible();
  },
};
export const NoPinnedGuide: Story = { args: { result: { kind: "ready", value: { ...home, pinnedSeries: null } }, feed: feed() } };

export const AiFirstGuide: Story = {
  args: { result: { kind: "ready", value: { ...home, pinnedSeries: aiFirstPin } }, feed: feed() },
};
export const AiFirstGuideMobile: Story = { ...AiFirstGuide, globals: mobile.globals };

/**
 * Лента главной приходит позже закрепа. Последовательность держит оба её ожидания открытыми, пока
 * проверка не снимет их по очереди: сначала граница Suspense вокруг ленты, затем первая страница
 * материалов.
 */
class FeedSequence {
  readonly shell: Promise<void>;
  readonly firstPage: Promise<void>;
  openShell: () => void = () => undefined;
  deliverFirstPage: () => void = () => undefined;

  constructor() {
    this.shell = new Promise((resolve) => { this.openShell = resolve; });
    this.firstPage = new Promise((resolve) => { this.deliverFirstPage = resolve; });
  }
}

function sequenceOf(loaded: Record<string, unknown>): FeedSequence {
  const sequence = loaded.sequence;
  if (!(sequence instanceof FeedSequence)) throw new Error("История загрузки не получила последовательность ленты");
  return sequence;
}

function SequencedFeed({ sequence }: { readonly sequence: FeedSequence }) {
  use(sequence.shell);
  const options = (state: LibrarySearchQuery) => createLibraryCatalogQueryOptions(async () => {
    await sequence.firstPage;
    return readyPage(state);
  }, state);
  return <HomeFeedView initialQuery={query} createQueryOptions={options} />;
}

interface FirstScreen {
  readonly featured: { readonly top: number; readonly height: number } | null;
  readonly materialsTop: number;
  readonly toolbar: { readonly top: number; readonly height: number };
  readonly firstRowTop: number;
}

function measureFirstScreen(canvasElement: HTMLElement): FirstScreen {
  const frame = canvasElement.querySelector(".home-page");
  const materials = frame?.querySelector(":scope > .home-feed");
  const toolbar = materials?.querySelector(":scope > .home-feed-toolbar");
  const firstRow = materials?.querySelector(".home-feed-post");
  if (materials == null || toolbar == null || firstRow == null) throw new Error("Первый экран главной отрисован не полностью");
  const featured = frame?.querySelector(":scope > .home-guide")?.getBoundingClientRect();
  const toolbarBox = toolbar.getBoundingClientRect();
  return {
    featured: featured === undefined ? null : { top: featured.top, height: featured.height },
    materialsTop: materials.getBoundingClientRect().top,
    toolbar: { top: toolbarBox.top, height: toolbarBox.height },
    firstRowTop: firstRow.getBoundingClientRect().top,
  };
}

/**
 * Первый экран не имеет права переехать, пока лента загружается: закреп уже известен серверу,
 * поэтому карточка продукта или её отсутствие стоят на месте, а лента проходит свою границу
 * Suspense и ожидание первой страницы в скелете той же геометрии. Расхождение между любыми двумя
 * состояниями роняет историю.
 */
function loadsInPlace({ globals, width }: StoryViewport): Pick<Story, "globals" | "loaders" | "render" | "play"> {
  return {
    globals,
    loaders: [() => {
      // Браузерный кеш запросов общий на все истории: готовая лента соседней истории отменила бы ожидание.
      getQueryClient().removeQueries({ queryKey: libraryCatalogQueryKey(query) });
      return { sequence: new FeedSequence() };
    }],
    render: (args, { loaded }) => <HomePage {...args} feed={<SequencedFeed sequence={sequenceOf(loaded)} />} />,
    play: async ({ canvasElement, loaded }) => {
      await expect(window.innerWidth).toBe(width);
      const sequence = sequenceOf(loaded);
      const canvas = within(canvasElement);
      await document.fonts.ready;
      const materials = await canvas.findByRole("region", { name: "Материалы" });
      await expect(materials).toHaveAttribute("aria-busy", "true");
      const boundary = measureFirstScreen(canvasElement);

      sequence.openShell();
      await canvas.findByRole("group", { name: "Формат материала" });
      const feed = within(canvas.getByRole("region", { name: "Материалы" }));
      await expect(feed.getByRole("status")).toHaveTextContent("Загружаем материалы…");
      const pendingPage = measureFirstScreen(canvasElement);

      sequence.deliverFirstPage();
      await feed.findByRole("list", { name: "Материалы, страница 1" });
      await waitFor(() => expect(feed.getByRole("status")).toHaveTextContent(`Материалов: ${String(items.length)}`));
      const ready = measureFirstScreen(canvasElement);

      await expect(pendingPage).toEqual(boundary);
      await expect(ready).toEqual(boundary);
    },
  };
}

export const NoPinnedGuideLoadsInPlace: Story = { args: NoPinnedGuide.args, ...loadsInPlace(desktop) };
export const NoPinnedGuideLoadsInPlaceMobile: Story = { args: NoPinnedGuide.args, ...loadsInPlace(mobile) };
export const AiFirstGuideLoadsInPlace: Story = { args: AiFirstGuide.args, ...loadsInPlace(desktop) };
export const AiFirstGuideLoadsInPlaceMobile: Story = { args: AiFirstGuide.args, ...loadsInPlace(mobile) };

/**
 * Скелет перехода из мобильной навигации ещё не знает закрепа и места под продукт не держит:
 * лента открывает каркас главной вплотную к его верху. История рисует его в рамке перехода, как
 * `PublicNavigationPending`; `args` нужны только типу `meta`.
 */
async function navigationSkeletonReservesNoProduct({ canvasElement }: { readonly canvasElement: HTMLElement }) {
  const frame = canvasElement.querySelector(".home-page");
  if (frame === null) throw new Error("Каркас главной не отрисован");
  const materials = within(canvasElement).getByRole("region", { name: "Материалы" });
  await expect(materials).toHaveAttribute("aria-busy", "true");
  await expect(materials.parentElement).toBe(frame);
  await expect(frame.querySelector(":scope > :not(h1, .home-feed)")).toBeNull();
  await expect(materials.getBoundingClientRect().top - frame.getBoundingClientRect().top).toBe(Number.parseFloat(getComputedStyle(materials).marginTop));
}

export const NavigationPending: Story = {
  args: NoPinnedGuide.args,
  globals: desktop.globals,
  decorators: [(Story) => <NavigationPendingFrame><Story /></NavigationPendingFrame>],
  render: () => <HomeLoading />,
  play: navigationSkeletonReservesNoProduct,
};
export const NavigationPendingMobile: Story = { ...NavigationPending, globals: mobile.globals };
