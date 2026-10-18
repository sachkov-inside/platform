import Link from "next/link";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { publicPageEnvironment } from "@/storybook/story-environment";
import { InlineArtifactDownload } from "./inline-artifact-download";

import {
  briefDownloadHref as href,
  briefArtifact as artifact,
} from "@/storybook/customer-brief.fixtures";
const environment = publicPageEnvironment(
  "/materials/inside-content-aie-project",
);
const meta = {
  ...environment,
  component: InlineArtifactDownload,
  title: "Features/Inline Artifact Download",
  decorators: [
    (Story) => (
      <div className="mx-auto max-w-[43rem] p-6">
        <p className="text-lg leading-relaxed">
          Передай файл своему агенту и сохрани его в проекте. <Story />
        </p>
        <p className="mt-4">
          <Link
            className="text-action underline underline-offset-4"
            href="/materials/inside-content-aie-product-brief"
          >
            Читать бриф на сайте
          </Link>
        </p>
      </div>
    ),
    ...environment.decorators,
  ],
  args: { artifact, href, label: "Скачать бриф (.md)" },
} satisfies Meta<typeof InlineArtifactDownload>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Available: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const action = canvas.getByRole("link", { name: "Скачать бриф (.md)" });
    await expect(action).toHaveAttribute("href", href);
    await expect(action).toHaveAttribute("download");
    await expect(canvas.getByText(/customer-brief.md/)).toBeVisible();
    await expect(
      canvas.getByRole("link", { name: "Читать бриф на сайте" }),
    ).toHaveAttribute("href", "/materials/inside-content-aie-product-brief");
    action.focus();
    await userEvent.keyboard("{Shift>}{Tab}{/Shift}");
    await userEvent.tab();
    await expect(action).toHaveFocus();
    await expect(
      parseFloat(getComputedStyle(action).outlineWidth),
    ).toBeGreaterThanOrEqual(2);
  },
};
export const Mobile: Story = {
  ...Available,
  globals: { viewport: { isRotated: false, value: "mobile390" } },
};
export const Locked: Story = {
  args: { artifact: { ...artifact, availability: "locked" } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.queryByRole("link", { name: "Скачать бриф (.md)" }),
    ).toBeNull();
    await expect(
      canvas.getByText("Файл откроется с доступом к продукту"),
    ).toBeVisible();
  },
};
export const Loading: Story = { args: { artifact: undefined, loading: true } };
export const Unavailable: Story = { args: { artifact: undefined } };
