import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { fetchBeforeRender } from "@/storybook/mutation-mock";
import { ProductCommunitySettings } from "./product-community-settings.client";
const productId = "22222222-2222-4222-8222-222222222222";
const meta = {
  title: "Features/ProductCommunitySettings",
  component: ProductCommunitySettings,
  args: { productId, onSaved: fn() },
  parameters: { layout: "padded" },
  beforeEach: () => {
    let connected = false;
    return fetchBeforeRender((_input, init) => {
      if (init?.method === "PUT") {
        connected = !connected;
        return Promise.resolve(
          Response.json({ ok: true, value: { ok: true } }),
        );
      }
      return Promise.resolve(
        Response.json({
          ok: true,
          value: {
            productId,
            groupRef: connected ? "primary" : null,
          },
        }),
      );
    })();
  },
} satisfies Meta<typeof ProductCommunitySettings>;
export default meta;
type Story = StoryObj<typeof meta>;
export const ConnectExistingGroup: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      await canvas.findByRole("button", { name: "Привязать текущую группу" }),
    );
    await expect(
      await canvas.findByRole("button", { name: "Отвязать текущую группу" }),
    ).toBeEnabled();
    await expect(args.onSaved).toHaveBeenCalledOnce();
  },
};
