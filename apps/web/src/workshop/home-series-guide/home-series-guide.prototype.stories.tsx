import type { Meta, StoryObj } from "@storybook/react-vite";
import { HomeSeriesGuidePrototype } from "./home-series-guide.prototype";
const meta = {
  title: "Pages/Inside showcase 290",
  component: HomeSeriesGuidePrototype,
  parameters: {
    docs: {
      description: {
        component:
          "Development-only #290. Selected A: Home hub with Series and subscription. Each Series has one explicit order. Related links are outside membership; mixed series demonstrates guide → video → note. B is historical reference only. Series, standalone video, guide A → B, tag discovery, series context and access states. No production routes, persistence or playback. Prototype state panel; URL preserves the current screen.",
      },
    },
    viewport: {
      options: {
        desktop1440x1024: {
          name: "Desktop 1440 × 1024",
          styles: { width: "1440px", height: "1024px" },
          type: "desktop",
        },
      },
    },
  },
} satisfies Meta<typeof HomeSeriesGuidePrototype>;
export default meta;
type Story = StoryObj<typeof meta>;
export const ValueFirst: Story = {
  args: { initialVariant: "A" },
  name: "A · Хаб + подписка",
};
export const SeriesFirst: Story = {
  args: { initialVariant: "B" },
  name: "Архив · Композиция main",
};
export const ValueFirstMobile: Story = {
  args: { initialVariant: "A" },
  globals: { viewport: { value: "mobile390", isRotated: false } },
  name: "A · Mobile 390",
};
export const SeriesFirstMobile: Story = {
  args: { initialVariant: "B" },
  globals: { viewport: { value: "mobile390", isRotated: false } },
  name: "Архив · Mobile 390",
};
export const VideoSeries: Story = {
  args: { initialScreen: "videos" },
  name: "Серия · видеодневник",
};
export const GuideSeries: Story = {
  args: { initialScreen: "guides" },
  name: "Серия · два гайда и связанные разборы",
};
export const FreeGuide: Story = {
  args: { initialScreen: "a" },
  name: "Гайд A · бесплатный образец",
};
export const LockedGuide: Story = {
  args: { initialScreen: "b" },
  name: "Гайд B · граница подписки",
};
export const MemberGuide: Story = {
  args: { initialScreen: "b", initialMember: true },
  name: "Гайд B · участник",
};
export const VideoPlaceholder: Story = {
  args: { initialScreen: "video", initialMember: true },
  name: "Видео · макет плеера",
};
export const TagDiscovery: Story = {
  args: { initialScreen: "tag" },
  name: "Поиск по тегу",
};

export const HubLibraryCatalog: Story = {
  args: { initialScreen: "library" },
  name: "Навигация · каталог образцов",
};

export const MixedSeries: Story = {
  args: { initialScreen: "review" },
  name: "Смешанная серия · гайд → видео → заметка",
};
