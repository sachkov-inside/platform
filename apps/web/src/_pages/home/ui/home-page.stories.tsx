import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { createLibraryCatalogQueryOptions, type LibraryCatalogPage, type LibrarySearchQuery } from "@/features/library-catalog";
import { publicPageEnvironment } from "@/workshop/story-environment";
import { aiFirstGuide } from "@/features/ai-first-guide";
import { HomePage } from "./home-page";
import { HomeFeedView } from "./home-feed.client";
import { illustratedHome } from "./illustrated-home.fixture";

const home = { ...illustratedHome, pinnedSeries: illustratedHome.playlists[1] ?? null };
const query = { after: null, q: "", sort: "newest", formatSlugs: [], topicSlug: null } as const;
const note = illustratedHome.notes[0];
if (note === undefined) throw new Error("Expected a note fixture");
const items = [
  ...illustratedHome.videos,
  { ...note, access: "free" as const, availability: "available" as const, formatSlug: "note", noteExcerpt: { text: "Маленький релиз легче проверить. Один результат, одна проверка — и понятный следующий шаг. Пример проекта — по ссылке ниже.", truncated: false, linkUrl: "https://github.com/sachkov-inside/platform" } },
  ...illustratedHome.guides,
];
function feed(result?: LibraryCatalogPage) {
  const options = (state: LibrarySearchQuery) => createLibraryCatalogQueryOptions(() => Promise.resolve(result ?? { kind: "ready", items: items.filter((item) => (state.formatSlugs.length === 0 || item.formatSlug === state.formatSlugs[0]) && item.title.toLowerCase().includes(state.q.toLowerCase())), facets: { formats: [], series: [], topics: [] }, nextCursor: null, totalCount: items.length }), state);
  return <HomeFeedView initialQuery={query} createQueryOptions={options} />;
}
const meta = { ...publicPageEnvironment("/"), component: HomePage, tags: ["autodocs"], title: "Pages/Mobile-first Platform/Home" } satisfies Meta<typeof HomePage>;
export default meta;
type Story = StoryObj<typeof meta>;

export const RealDataReady: Story = {
  args: { result: { kind: "ready", value: home }, feed: feed() },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("link", { name: "Открыть практикум" })).toBeInTheDocument();
    await expect(canvas.getByRole("region", { name: "Материалы" })).toBeInTheDocument();
    await expect(canvas.getByRole("group", { name: "Формат материала" })).toBeInTheDocument();
    await expect(await canvas.findByRole("link", { name: "Открыть github.com в новой вкладке" })).toHaveAttribute("href", "https://github.com/sachkov-inside/platform");
    await expect(canvas.queryByText("Что даёт подписка")).not.toBeInTheDocument();
    await expect(canvas.queryByText("База знаний")).not.toBeInTheDocument();
  },
};
export const EmptyFeed: Story = { args: { result: { kind: "ready", value: home }, feed: feed({ kind: "empty" }) } };
export const Unavailable: Story = { args: { result: { kind: "unavailable" }, feed: feed({ kind: "unavailable" }) } };
export const NoPinnedGuide: Story = { args: { result: { kind: "ready", value: { ...home, pinnedSeries: null } }, feed: feed() } };

export const AiFirstGuide: Story = {
  args: { result: { kind: "ready", value: { ...home, pinnedSeries: { id: "ai-first-guide", cover: null, previewItems: [], slug: aiFirstGuide.slug, name: "AI-first разработка", summary: aiFirstGuide.description, count: 6 } } }, feed: feed() },
};
export const AiFirstGuideMobile: Story = { ...AiFirstGuide, globals: { viewport: { value: "mobile390", isRotated: false } } };
