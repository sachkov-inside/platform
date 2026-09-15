import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, waitFor } from "storybook/test";

import { AiFirstProcessArtwork } from "./ai-first-process-artwork";

const meta = {
  component: AiFirstProcessArtwork,
  title: "Features/Guide/AI-first process",
  parameters: { layout: "centered" },
  play: async ({ canvasElement }) => {
    const host = canvasElement.querySelector(".ai-process-artwork");
    const stage = canvasElement.querySelector(".stage");
    if (!host || !stage) throw new Error("Missing process artwork");
    const container = host.getBoundingClientRect();
    const illustration = stage.getBoundingClientRect();
    await expect(container.height).toBeGreaterThan(0);
    await expect(Math.abs(illustration.x - container.x)).toBeLessThan(1);
    await expect(Math.abs(illustration.y - container.y)).toBeLessThan(1);
    await expect(Math.abs(illustration.width - container.width)).toBeLessThan(1);
    await expect(Math.abs(illustration.height - container.height)).toBeLessThan(1);
  },
  render: args => <div style={{ width: "min(512px, calc(100vw - 32px))", height: 432, overflow: "hidden", borderRadius: 16 }}><AiFirstProcessArtwork {...args} /></div>,
} satisfies Meta<typeof AiFirstProcessArtwork>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Home: Story = {};
export const Context: Story = { args: { mode: "static", scene: 1 } };
export const Harness: Story = { args: { mode: "static", scene: 2 } };
export const Architecture: Story = { args: { mode: "static", scene: 3 } };
export const Review: Story = { args: { mode: "static", scene: 4 } };
export const Release: Story = { args: { mode: "static", scene: 5 } };
export const Mobile: Story = {
  render: args => <div style={{ width: 358, height: 230, overflow: "hidden", borderRadius: 16 }}><AiFirstProcessArtwork {...args} /></div>,
};
export const MobileContext: Story = { ...Mobile, args: { mode: "static", scene: 1 } };
export const MobileHarness: Story = { ...Mobile, args: { mode: "static", scene: 2 } };
export const MobileArchitecture: Story = { ...Mobile, args: { mode: "static", scene: 3 } };
export const MobileReview: Story = { ...Mobile, args: { mode: "static", scene: 4 } };
export const MobileRelease: Story = { ...Mobile, args: { mode: "static", scene: 5 } };
export const ReducedMotion: Story = {
  parameters: { docs: { description: { story: "При системном prefers-reduced-motion показывается сцена 5. Здесь проверяем и изменение настройки во время показа." } } },
  play: async ({ canvasElement }) => {
    await waitFor(async () => { await expect(canvasElement.querySelector(".stage")).toHaveAttribute("data-scene", "5"); });
    await expect(canvasElement.querySelector(".stage")).toHaveClass("is-static");
  },
};
