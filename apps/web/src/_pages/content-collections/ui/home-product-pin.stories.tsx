import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { HomeProductPinView } from "@/features/product-order";
import { ProductEditorPageFrame } from "@/_pages/content-collections";

import { authoringPageEnvironment } from "@/storybook/story-environment";

const productId = "72000000-0000-4000-8000-000000000298";
const environment = authoringPageEnvironment(
  `/authoring/products/${productId}`,
  {
    frame: ProductEditorPageFrame,
  },
);
const onChange = fn();
const meta = {
  ...environment,
  component: HomeProductPinView,
  id: "features-product-home-pin",
  title: "Patterns/Authoring/Home pin",
  args: {
    productId,
    controls: {
      pin: { productId: null, version: 2 },
      pending: false,
      onChange,
    },
    message:
      "Закрепите этот продукт: он появится первым на главной с изображением автора.",
  },
  tags: ["autodocs"],
} satisfies Meta<typeof HomeProductPinView>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Available: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(
      within(canvasElement).getByRole("button", {
        name: "Закрепить на главной",
      }),
    );
    await expect(onChange).toHaveBeenCalledWith(productId);
  },
};
export const Selected: Story = {
  args: {
    controls: { pin: { productId, version: 3 }, pending: false, onChange },
    message: "Продукт закреплён на главной.",
  },
  play: async ({ canvasElement }) => {
    await userEvent.click(
      within(canvasElement).getByRole("button", {
        name: "Снять закреп с главной",
      }),
    );
    await expect(onChange).toHaveBeenCalledWith(null);
  },
};
export const Loading: Story = {
  args: {
    controls: { pin: null, pending: false, onChange },
    message: "Загружаем закреп…",
  },
};
export const Saving: Story = {
  args: {
    controls: { pin: { productId: null, version: 2 }, pending: true, onChange },
  },
};
export const Conflict: Story = {
  args: {
    hasError: true,
    onRetry: fn(),
    message:
      "Закреп изменился в другой вкладке. Состояние обновлено; закрепите продукт ещё раз.",
  },
};
export const Unavailable: Story = {
  args: {
    controls: { pin: null, pending: false, onChange },
    hasError: true,
    onRetry: fn(),
    message:
      "Закреп временно недоступен. Обновите состояние и повторите действие.",
  },
};
export const Mobile: Story = {
  ...Selected,
  globals: { viewport: { value: "mobile390", isRotated: false } },
};
