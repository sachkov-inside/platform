import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";

import { ProseAnchor } from "./prose-anchor.client";
import { proseLinkClassName } from "./prose-link";

const meta = {
  component: ProseAnchor,
  title: "Components/Navigation/ProseAnchor",
  args: {
    href: "https://example.com/docs",
    className: proseLinkClassName,
    children: "Документация",
  },
} satisfies Meta<typeof ProseAnchor>;
export default meta;
type Story = StoryObj<typeof meta>;

export const External: Story = {
  play: async ({ canvasElement }) => {
    const link = within(canvasElement).getByRole("link");
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", "noopener noreferrer");
  },
};

export const Internal: Story = {
  args: { href: "/materials/next#section" },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole("link")).not.toHaveAttribute(
      "target",
    );
  },
};

export const SameOrigin: Story = {
  ...Internal,
  render: (args) => (
    <ProseAnchor
      {...args}
      href={`${window.location.origin}/materials/current#section`}
    />
  ),
};

export const SameOriginProtocolRelative: Story = {
  ...Internal,
  render: (args) => (
    <ProseAnchor
      {...args}
      href={`//${window.location.host}/materials/current#section`}
    />
  ),
};
