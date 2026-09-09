import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { ApplicationShell } from "@/widgets/application-shell";
import { HomePage } from "./home-page";
import { HomeLoading } from "./home-loading";
import { illustratedHome } from "./illustrated-home.fixture";
import type { HomeView } from "../model/home-view";

const home: HomeView = {
  ...illustratedHome,
  pinnedSeries: illustratedHome.playlists[0] ?? null,
  membership: { kind: "inactive", acquisitionUrl: "https://t.me/tribute" },
  playlists: illustratedHome.playlists.map((series, index) => index === 0 ? {
    ...series, name: "Создаём реальный продукт с ИИ", summary: "От идеи и архитектуры до кода и деплоя. На примере самой платформы Inside.",
  } : series),
};
const meta = {
  component: HomePage,
  title: "Pages/Home/Guest",
  decorators: [(Story) => <ApplicationShell currentPath="/" navigationItems={[{ href: "/", icon: "home", label: "Главная" }, { href: "/library", icon: "library", label: "База знаний" }]} mobileNavigationItems={[{ href: "/", icon: "home", label: "Главная" }, { href: "/library", icon: "library", label: "База знаний" }, { href: "/account", icon: "profile", label: "Профиль" }]}><Story /></ApplicationShell>],
  parameters: { layout: "fullscreen" },
  tags: ["autodocs"],
} satisfies Meta<typeof HomePage>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Ready: Story = {
  args: { result: { kind: "ready", value: home } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("link", { name: "Открыть руководство" })).toHaveAttribute("href", `/guides/${String(home.pinnedSeries?.slug)}?from=%2F`);
    await expect(canvas.getByRole("link", { name: /^Полный доступ$/u })).toHaveAttribute("href", "https://t.me/tribute");
    await expect(canvas.queryByRole("heading", { name: "Все материалы в одном каталоге" })).not.toBeInTheDocument();
    const sections = Array.from(canvasElement.querySelectorAll('section[aria-labelledby], section[aria-label="Подписка Inside"]'), (section) => section.getAttribute("aria-labelledby") ?? section.getAttribute("aria-label"));
    await expect(sections).toEqual(["featured-title", "home-series", "Подписка Inside", "home-videos", "home-guides", "home-notes", "home-benefits", "home-full-access"]);
  },
};
export const Mobile: Story = { ...Ready, globals: { viewport: { value: "mobile390", isRotated: false } } };
export const ActiveMember: Story = { args: { result: { kind: "ready", value: { ...home, membership: { kind: "active" } } } }, play: noAcquisition };
export const UnknownMembership: Story = { args: { result: { kind: "ready", value: { ...home, membership: { kind: "unknown" } } } }, play: noAcquisition };
export const Empty: Story = { args: { result: { kind: "ready", value: { ...home, pinnedSeries: null, playlists: [], videos: [], guides: [], notes: [], topics: [] } } }, play: async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  await expect(canvas.queryByRole("link", { name: "Открыть руководство" })).not.toBeInTheDocument();
  await expect(canvas.getByText("Руководств пока нет.")).toBeVisible();
} };
export const Unavailable: Story = { args: { result: { kind: "unavailable" } }, play: noAcquisition };
export const Loading: Story = { args: { result: { kind: "unavailable" } }, render: () => <HomeLoading /> };
export const LongSeries: Story = { args: { result: { kind: "ready", value: { ...home, pinnedSeries: home.pinnedSeries === null ? null : { ...home.pinnedSeries, name: "Проектируем и развиваем приложение: от первой идеи до надёжного релиза с искусственным интеллектом", summary: "" } } } } };

async function noAcquisition({ canvasElement }: { canvasElement: HTMLElement }) {
  const canvas = within(canvasElement);
  await expect(canvas.queryByRole("region", { name: "Подписка Inside" })).not.toBeInTheDocument();
  await expect(canvas.queryByRole("link", { name: "Получить полный доступ" })).not.toBeInTheDocument();
  if (canvas.queryByRole("heading", { name: "Главная" })) await expect(canvas.getByRole("link", { name: "Открыть руководство" })).toBeVisible();
}

export const NoPin: Story = { args: { result: { kind: "ready", value: { ...home, pinnedSeries: null } } }, play: async ({ canvasElement }) => { await expect(canvasElement.querySelector("#featured-title")).toBeNull(); } };
