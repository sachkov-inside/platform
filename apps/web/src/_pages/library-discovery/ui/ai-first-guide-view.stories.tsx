import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";

import { aiFirstGuide } from "@/features/ai-first-guide";
import { homeMaterialReaderReturnTarget, materialReaderHref } from "@/shared/routing/material-reader";
import { publicPageEnvironment } from "@/workshop/story-environment";

import { GuideProductView } from "./guide-product-view";

const environment = publicPageEnvironment("/guides/working-with-agents");
const meta = {
  ...environment,
  component: GuideProductView,
  title: "Pages/Guide/AI-first",
  args: {
    returnTarget: homeMaterialReaderReturnTarget,
    result: {
      kind: "empty", discoveryKind: "series", chapters: [], relatedSeries: [], topics: [],
      reference: { name: "AI-first разработка", slug: aiFirstGuide.slug, summary: aiFirstGuide.description },
    },
  },
} satisfies Meta<typeof GuideProductView>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Desktop: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("heading", { name: "AI-first разработка" })).toBeVisible();
    for (const link of canvas.getAllByRole("link", { name: "Открыть программу" })) {
      await expect(link).toHaveAttribute("href", "/guides/working-with-agents/programme");
    }
  },
};
export const Mobile: Story = { globals: { viewport: { value: "mobile390", isRotated: false } } };

export const FreeEntryOpensWholeProgramme: Story = {
  args: { freeEntryHref: materialReaderHref("first-lesson") },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole("link", { name: "Посмотреть бесплатные уроки" })).toHaveAttribute("href", "/guides/working-with-agents/programme");
  },
};
