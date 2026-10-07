import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";

import { internalRoute } from "@/shared/routing/internal-route";
import {
  publicPageEnvironment,
  routeContent,
} from "@/storybook/story-environment";

import { PaymentCheckoutUnavailable } from "./payment-checkout-unavailable";

const returnTo = internalRoute(
  "/payment/checkout?offer=invitation-only&from=programme&promo=personal-code",
);
const environment = publicPageEnvironment("/payment/checkout");
const meta = {
  ...environment,
  title: "Pages/Payment/Checkout",
  component: PaymentCheckoutUnavailable,
  args: { viewer: "guest", returnTo },
  parameters: {
    ...environment.parameters,
    docs: {
      description: {
        component:
          "Ссылка тарифа обычно перенаправляет на покупку его продукта. Если тариф отсутствует в доступном каталоге, гость входит с сохранением ссылки, а вошедший покупатель видит отказ.",
      },
    },
  },
} satisfies Meta<typeof PaymentCheckoutUnavailable>;
export default meta;
type Story = StoryObj<typeof meta>;

export const GuestSignIn: Story = {
  globals: { viewport: { isRotated: false, value: "desktop1440" } },
  play: async ({ canvasElement }) => {
    await expect(
      routeContent(canvasElement).getByRole("button", { name: "Войти" }),
    ).toBeEnabled();
    const input = canvasElement.querySelector<HTMLInputElement>(
      'main input[name="returnTo"]',
    );
    await expect(input?.value).toBe(returnTo);
  },
};

export const GuestSignInMobile: Story = {
  ...GuestSignIn,
  globals: { viewport: { isRotated: false, value: "mobile390" } },
};

export const SignedInDenied: Story = {
  globals: { viewport: { isRotated: false, value: "desktop1440" } },
  args: { viewer: "member" },
  parameters: { account: "authenticated" },
  play: async ({ canvasElement }) => {
    const canvas = routeContent(canvasElement);
    await expect(canvas.getByRole("status")).toHaveTextContent(
      "Выбранный тариф сейчас недоступен для покупки.",
    );
    await expect(canvas.queryByRole("button")).not.toBeInTheDocument();
  },
};

export const SignedInDeniedMobile: Story = {
  ...SignedInDenied,
  globals: { viewport: { isRotated: false, value: "mobile390" } },
};
