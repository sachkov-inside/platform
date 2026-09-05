import type { Meta, StoryObj } from "@storybook/react-vite";
import { HomeSeriesGuidePrototype } from "./home-series-guide.prototype";
const meta = {
  title: "Pages/Inside showcase 290",
  component: HomeSeriesGuidePrototype,
  parameters: {
    docs: {
      description: {
        component:
          "Development-only #290. Two Home compositions on Workspace #112 samples. Series, standalone video, guide A → B, tag discovery, series context and access states. No production routes, persistence or playback. Floating A/B control; URL preserves the current screen.",
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
  name: "A · Сначала ценность",
};
export const SeriesFirst: Story = {
  args: { initialVariant: "B" },
  name: "B · Сначала серии",
};
export const ValueFirstMobile: Story = {
  args: { initialVariant: "A" },
  globals: { viewport: { value: "mobile390", isRotated: false } },
  name: "A · Mobile 390",
};
export const SeriesFirstMobile: Story = {
  args: { initialVariant: "B" },
  globals: { viewport: { value: "mobile390", isRotated: false } },
  name: "B · Mobile 390",
};
export const VideoSeries: Story = {
  args: { initialScreen: "videos" },
  name: "Состав видеоплейлиста",
};
export const GuideSeries: Story = {
  args: { initialScreen: "guides" },
  name: "Состав серии гайдов",
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
