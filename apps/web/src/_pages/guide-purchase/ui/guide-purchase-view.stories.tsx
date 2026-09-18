import type { Meta, StoryObj } from "@storybook/react-vite";
import { Suspense, use } from "react";
import { expect, within } from "storybook/test";

import { guideOnlyOffer } from "@/workshop/billing.fixtures";
import { boxOf, desktop, mobile, originOf, settleStoryFrame, stagedLoaders, stagedLoadingOf, type StagedLoading, type StoryViewport } from "@/workshop/loads-in-place";

import { GuidePurchaseLoading } from "./guide-purchase-loading";
import { GuidePurchaseView, type GuidePurchaseViewProps } from "./guide-purchase-view";

import { publicPageEnvironment, routeContent } from "@/workshop/story-environment";

const guide = {
  name: "Создание Platform Inside",
  summary: "Как устроен продукт: архитектура, границы и порядок поставки.",
};

const environment = publicPageEnvironment("/guides/platform-inside/buy");

const meta = {
  ...environment,
  title: "Pages/Guide/Purchase",
  component: GuidePurchaseView,
  args: {
    guide,
    offer: guideOnlyOffer,
    slug: "platform-inside",
    viewer: "member",
    children: (
      <p className="rounded-2xl border border-border bg-card p-6 text-sm shadow-card">
        Оформление покупки
      </p>
    ),
  },
  parameters: {
    ...environment.parameters,
    docs: {
      description: {
        component:
          "Продукт продаётся, только когда владелец завёл ему цену. Отсутствие предложения — обычное состояние, а не ошибка, и подписка на эту страницу не влияет.",
      },
    },
  },
} satisfies Meta<typeof GuidePurchaseView>;
export default meta;
type Story = StoryObj<typeof meta>;

export const ForSale: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("heading", { level: 1 })).toHaveTextContent(
      guide.name,
    );
    // Страница оплаты ведёт обратно в программу: там читатель видел бесплатные уроки.
    await expect(
      canvas.getByRole("link", { name: "Программа" }),
    ).toBeInTheDocument();
    // Само оформление собирает клиентская обвязка: здесь она заменена заглушкой.
    await expect(canvas.getByText("Оформление покупки")).toBeInTheDocument();
  },
};

export const NotForSale: Story = {
  args: { offer: null },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("status")).toHaveTextContent(
      "не продаётся отдельно",
    );
    await expect(
      canvas.getByRole("link", { name: "Программа" }),
    ).toBeInTheDocument();
  },
};

export const PriceUnavailable: Story = {
  args: { unavailable: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // Временный сбой не выдаётся за «не продаётся».
    await expect(canvas.getByRole("status")).toHaveTextContent(
      "Цена сейчас недоступна",
    );
  },
};

export const SignedOut: Story = {
  args: { viewer: "guest" },
  play: async ({ canvasElement }) => {
    // Вход есть и в шапке оболочки: проверяем приглашение самой страницы.
    const canvas = routeContent(canvasElement);
    await expect(canvas.getByRole("button", { name: "Войти" })).toBeEnabled();
    // Цена в приглашении войти приходит из снимка сервера, а не из разметки.
    await expect(
      canvas.getByText((_, node) => node?.textContent?.includes("2\u00a0500") === true, {
        selector: "p",
      }),
    ).toBeInTheDocument();
  },
};

export const Loading: Story = { args: { viewer: "loading" } };

export const PurchasesUnavailable: Story = {
  args: { notice: "Данные оплаты сейчас недоступны. Повторите позже." },
};

export const Mobile: Story = {
  globals: { viewport: { isRotated: false, value: "mobile390" } },
};

export const Desktop: Story = {
  globals: { viewport: { isRotated: false, value: "desktop1440" } },
};

function StagedPurchase({ sequence, ...props }: GuidePurchaseViewProps & { readonly sequence: StagedLoading }) {
  return <Suspense fallback={<GuidePurchaseLoading />}><ArrivedPurchase sequence={sequence} {...props} /></Suspense>;
}

function ArrivedPurchase({ sequence, ...props }: GuidePurchaseViewProps & { readonly sequence: StagedLoading }) {
  use(sequence.sharedPart);
  return <GuidePurchaseView {...props} />;
}

const purchaseFrameOf = (canvasElement: HTMLElement) => ({
  back: originOf(boxOf(canvasElement, "[data-purchase-part='back']")),
  title: originOf(boxOf(canvasElement, "[data-purchase-part='title']")),
});

/**
 * Страница оплаты лежит под адресом продукта и без своего скелета показывала бы его скелет (#670).
 * Ряд возврата и заголовок стоят на месте с первого кадра: страница встаёт на место скелета.
 */
function loadsInPlace({ globals, width }: StoryViewport): Pick<Story, "globals" | "loaders" | "render" | "play"> {
  return {
    globals,
    loaders: stagedLoaders,
    render: (args, { loaded }) => <StagedPurchase {...args} sequence={stagedLoadingOf(loaded)} />,
    play: async ({ canvasElement, loaded }) => {
      await settleStoryFrame(width);
      const canvas = within(canvasElement);
      await expect(await canvas.findByLabelText("Оплата загружается")).toHaveAttribute("aria-busy", "true");
      const skeleton = purchaseFrameOf(canvasElement);

      stagedLoadingOf(loaded).deliverSharedPart();
      await canvas.findByRole("heading", { level: 1, name: guide.name });

      await expect(skeleton).toEqual(purchaseFrameOf(canvasElement));
    },
  };
}

export const LoadsInPlace: Story = { ...loadsInPlace(desktop) };
export const LoadsInPlaceMobile: Story = { ...loadsInPlace(mobile) };
