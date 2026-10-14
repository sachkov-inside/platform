import { productCapability } from "@inside/access-capabilities";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { fetchBeforeRender } from "@/storybook/mutation-mock";
import { ProductRevocationPanel } from "./product-revocation-panel.client";
const accountId = "11111111-1111-4111-8111-111111111111";
const productId = "22222222-2222-4222-8222-222222222222";
const meta = {
  title: "Features/BillingAdmin/ProductRevocation",
  component: ProductRevocationPanel,
  args: { accountId, onRevoked: fn() },
  parameters: { layout: "padded" },
  beforeEach: fetchBeforeRender((input) => {
    const path = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url,
      window.location.origin,
    ).pathname;
    if (path.endsWith("/content/list"))
      return Promise.resolve(
        Response.json({
          ok: true,
          value: {
            operationRef: accountId,
            result: {
              outcome: "content",
              items: [
                {
                  kind: "product",
                  id: productId,
                  title: "Создание Platform Inside",
                  slug: "platform-inside",
                  available: true,
                },
              ],
            },
          },
        }),
      );
    if (path.endsWith("/preview-revoke"))
      return Promise.resolve(
        Response.json({
          ok: true,
          value: {
            ok: true,
            value: {
              accountId,
              productId,
              revision: 2,
              affectedCount: 2,
              affected: [
                {
                  source: "paid",
                  capabilities: [productCapability(productId)],
                  validUntil: null,
                },
                {
                  source: "manual",
                  capabilities: [productCapability(productId)],
                  validUntil: null,
                },
              ],
            },
          },
        }),
      );
    return Promise.resolve(
      Response.json({
        ok: true,
        value: {
          ok: true,
          value: { accountId, productId, revision: 3, access: "revoked" },
        },
      }),
    );
  }),
} satisfies Meta<typeof ProductRevocationPanel>;
export default meta;
type Story = StoryObj<typeof meta>;
export const RevokeWholeProduct: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await canvas.findByRole("option", { name: "Создание Platform Inside" });
    await userEvent.selectOptions(canvas.getByRole("combobox"), productId);
    await userEvent.click(
      canvas.getByRole("button", { name: "Проверить доступ" }),
    );
    await canvas.findByLabelText("Причина");
    await expect(canvas.queryByRole("checkbox")).not.toBeInTheDocument();
    await userEvent.type(canvas.getByLabelText("Причина"), "Решение оператора");
    await userEvent.click(
      canvas.getByRole("button", { name: "Отозвать доступ к продукту" }),
    );
    await expect(await canvas.findByRole("status")).toHaveTextContent(
      "Доступ к продукту отозван",
    );
    await expect(args.onRevoked).toHaveBeenCalledOnce();
  },
};
