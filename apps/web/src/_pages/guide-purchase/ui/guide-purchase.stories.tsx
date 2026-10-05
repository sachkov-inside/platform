import type { Meta, StoryObj } from "@storybook/react-vite";
import { Suspense, use } from "react";
import { expect, waitFor, within } from "storybook/test";

import { billingErrorMessage } from "@/entities/subscription";
import { getQueryClient } from "@/shared/api/query-client";
import {
  billingContactResponse,
  billingFailureResponse,
  currentBillingResponse,
  guideOnlyOffer,
  guideQuote,
  guideWithSupportOffer,
} from "@/storybook/billing.fixtures";
import {
  boxOf,
  desktop,
  mobile,
  originOf,
  settleStoryFrame,
  stagedLoaders,
  stagedLoadingOf,
  type StagedLoading,
  type StoryViewport,
} from "@/storybook/loads-in-place";
import { fetchBeforeRender } from "@/storybook/mutation-mock";
import {
  publicPageEnvironment,
  routeContent,
} from "@/storybook/story-environment";

import {
  GuidePurchase,
  type GuidePurchaseProps,
} from "./guide-purchase.client";
import { GuidePurchaseLoading } from "./guide-purchase-loading";

/** Путь запроса к собственному BFF, без адреса страницы и параметров. */
function requestPath(input: RequestInfo | URL): string {
  const target =
    input instanceof Request
      ? input.url
      : input instanceof URL
        ? input.href
        : input;
  return new URL(target, window.location.origin).pathname;
}

const guide = {
  name: "Создание Platform Inside",
  summary: "Как устроен продукт: архитектура, границы и порядок поставки.",
};

/** Что ответил собственный billing BFF на чтение покупок этого человека. */
type Viewer = "member" | "guest" | "loading" | "billing-unavailable";

/**
 * Маршрут `/products/<slug>/buy` глазами этого человека: шапка показывает тот же аккаунт, а
 * `GuidePurchase` читает покупки, контакт для чеков и расчёт цены через свои BFF. Кеш запросов
 * общий на все истории, поэтому ответы прошлой истории перед каждой стираются.
 */
function purchaseRoute(
  viewer: Viewer,
): Pick<Story, "beforeEach" | "decorators" | "parameters"> {
  const { beforeEach, decorators, parameters } = publicPageEnvironment(
    "/products/platform-inside/buy",
    { account: viewer === "guest" ? "guest" : "authenticated" },
  );
  return {
    beforeEach: () => {
      beforeEach();
      getQueryClient().removeQueries({ queryKey: ["account"] });
      return fetchBeforeRender((input) => {
        const path = requestPath(input);
        if (viewer === "guest")
          return Promise.resolve(billingFailureResponse("unauthorized"));
        if (path === "/api/account/billing")
          return viewer === "loading"
            ? new Promise<Response>(() => undefined)
            : Promise.resolve(
                viewer === "billing-unavailable"
                  ? billingFailureResponse("unavailable")
                  : currentBillingResponse(null),
              );
        if (path === "/api/account/billing/contact")
          return Promise.resolve(billingContactResponse());
        if (path === "/api/account/billing/quote")
          return Promise.resolve(
            Response.json({ ok: true, value: guideQuote }),
          );
        return Promise.resolve(billingFailureResponse("unavailable"));
      })();
    },
    decorators,
    parameters,
  };
}

const meta = {
  title: "Pages/Guide/Purchase",
  component: GuidePurchase,
  args: {
    guide,
    offers: [guideOnlyOffer],
    slug: "platform-inside",
  },
  parameters: {
    docs: {
      description: {
        component:
          "Продукт продаётся, только когда владелец завёл ему цену. Отсутствие предложения — обычное состояние, а не ошибка, и подписка на эту страницу не влияет.",
      },
    },
  },
} satisfies Meta<typeof GuidePurchase>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Вошедший покупатель: оформление собирает настоящий поток расчёта, согласий и оплаты. */
export const ForSale: Story = {
  ...purchaseRoute("member"),
  globals: { viewport: { isRotated: false, value: "desktop1440" } },
  play: async ({ canvasElement }) => {
    const canvas = routeContent(canvasElement);
    await expect(canvas.getByRole("heading", { level: 1 })).toHaveTextContent(
      guide.name,
    );
    // Страница оплаты ведёт обратно в программу: там читатель видел бесплатные уроки.
    await expect(
      canvas.getByRole("link", { name: "Программа" }),
    ).toBeInTheDocument();
    const pay = await canvas.findByRole("button", { name: /^Оплатить /u });
    await waitFor(() => expect(pay).toBeEnabled());
  },
};

export const ForSaleMobile: Story = {
  ...ForSale,
  globals: { viewport: { isRotated: false, value: "mobile390" } },
};

/** У продукта несколько вариантов: выбор стоит над оформлением, первый выбран сразу. */
export const TwoOffers: Story = {
  ...purchaseRoute("member"),
  args: { offers: [guideOnlyOffer, guideWithSupportOffer] },
  globals: { viewport: { isRotated: false, value: "mobile390" } },
  play: async ({ canvasElement }) => {
    const canvas = routeContent(canvasElement);
    const options = await canvas.findAllByRole("radio");
    await expect(options).toHaveLength(2);
    await expect(options[0]).toBeChecked();
  },
};

export const NotForSale: Story = {
  ...purchaseRoute("member"),
  args: { offers: [] },
  play: async ({ canvasElement }) => {
    const canvas = routeContent(canvasElement);
    await expect(canvas.getByRole("status")).toHaveTextContent(
      "не продаётся отдельно",
    );
    await expect(
      canvas.getByRole("link", { name: "Программа" }),
    ).toBeInTheDocument();
  },
};

export const PriceUnavailable: Story = {
  ...purchaseRoute("member"),
  args: { offers: [], unavailable: true },
  play: async ({ canvasElement }) => {
    const canvas = routeContent(canvasElement);
    // Временный сбой не выдаётся за «не продаётся».
    await expect(canvas.getByRole("status")).toHaveTextContent(
      "Цена сейчас недоступна",
    );
  },
};

export const SignedOut: Story = {
  ...purchaseRoute("guest"),
  play: async ({ canvasElement }) => {
    // Вход есть и в шапке оболочки: проверяем приглашение самой страницы.
    const canvas = routeContent(canvasElement);
    await expect(
      await canvas.findByRole("button", { name: "Войти" }),
    ).toBeEnabled();
    // Цена в приглашении войти приходит из снимка сервера, а не из разметки.
    await expect(
      canvas.getByText(
        (_, node) => node?.textContent.includes("2 500") === true,
        {
          selector: "p",
        },
      ),
    ).toBeInTheDocument();
  },
};

/** Персональная ссылка владельца: код переживает вход, а цену со скидкой назовёт расчёт (#815). */
export const SignedOutWithPersonalLink: Story = {
  ...purchaseRoute("guest"),
  args: { promoCode: "Syn7hetic-Code" },
  play: async ({ canvasElement }) => {
    const canvas = routeContent(canvasElement);
    await expect(
      await canvas.findByText(/скидка по ссылке применится/u),
    ).toBeInTheDocument();
    const returnTo = canvasElement.querySelector<HTMLInputElement>(
      'input[name="returnTo"]',
    );
    await expect(returnTo?.value).toMatch(/\/buy\?promo=Syn7hetic-Code$/u);
  },
};

/** Покупки ещё читаются: страница не показывает ни оформление, ни приглашение войти. */
export const Loading: Story = {
  ...purchaseRoute("loading"),
  play: async ({ canvasElement }) => {
    await expect(
      routeContent(canvasElement).getByText("Проверяем ваши покупки…"),
    ).toBeVisible();
  },
};

export const PurchasesUnavailable: Story = {
  ...purchaseRoute("billing-unavailable"),
  play: async ({ canvasElement }) => {
    await expect(
      await routeContent(canvasElement).findByText(
        billingErrorMessage("unavailable"),
      ),
    ).toBeVisible();
  },
};

function StagedPurchase({
  sequence,
  ...props
}: GuidePurchaseProps & { readonly sequence: StagedLoading }) {
  return (
    <Suspense fallback={<GuidePurchaseLoading />}>
      <ArrivedPurchase sequence={sequence} {...props} />
    </Suspense>
  );
}

function ArrivedPurchase({
  sequence,
  ...props
}: GuidePurchaseProps & { readonly sequence: StagedLoading }) {
  use(sequence.sharedPart);
  return <GuidePurchase {...props} />;
}

const purchaseFrameOf = (canvasElement: HTMLElement) => ({
  back: originOf(boxOf(canvasElement, "[data-purchase-part='back']")),
  title: originOf(boxOf(canvasElement, "[data-purchase-part='title']")),
});

/**
 * Страница оплаты лежит под адресом продукта и без своего скелета показывала бы его скелет (#670).
 * Ряд возврата и заголовок стоят на месте с первого кадра: страница встаёт на место скелета.
 */
function loadsInPlace({
  globals,
  width,
}: StoryViewport): Pick<
  Story,
  | "beforeEach"
  | "decorators"
  | "globals"
  | "loaders"
  | "parameters"
  | "play"
  | "render"
> {
  return {
    ...purchaseRoute("member"),
    globals,
    loaders: stagedLoaders,
    render: (args, { loaded }) => (
      <StagedPurchase {...args} sequence={stagedLoadingOf(loaded)} />
    ),
    play: async ({ canvasElement, loaded }) => {
      await settleStoryFrame(width);
      const canvas = within(canvasElement);
      await expect(
        await canvas.findByLabelText("Оплата загружается"),
      ).toHaveAttribute("aria-busy", "true");
      const skeleton = purchaseFrameOf(canvasElement);

      stagedLoadingOf(loaded).deliverSharedPart();
      await canvas.findByRole("heading", { level: 1, name: guide.name });

      await expect(skeleton).toEqual(purchaseFrameOf(canvasElement));
    },
  };
}

export const LoadsInPlace: Story = loadsInPlace(desktop);
export const LoadsInPlaceMobile: Story = loadsInPlace(mobile);
