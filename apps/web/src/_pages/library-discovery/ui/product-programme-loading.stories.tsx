import type { Meta, StoryObj } from "@storybook/react-vite";
import { Suspense, use } from "react";
import { expect, within } from "storybook/test";

import {
  MaterialReadingScope,
  type MaterialPreview,
} from "@/entities/material";
import type { PublishedProductResult } from "@/features/library-discovery";
import { productOnlyOffer } from "@/storybook/billing.fixtures";
import {
  boxOf,
  desktop,
  mobile,
  originOf,
  settleStoryFrame,
  stagedLoaders,
  stagedLoadingOf,
  type StagedLoading,
  type Box,
  type StoryViewport,
} from "@/storybook/loads-in-place";
import { publicPageEnvironment } from "@/storybook/story-environment";

import { ProductProgrammeView } from "./product-programme-view";
import { ProductProgrammeLoading } from "./library-discovery-loading";
import { PendingProduct } from "./product-programme-view";
import { ProductLearningProvider } from "./product-learning.client";

const titles = [
  "От идеи к первой версии",
  "Границы продукта",
  "Сценарии пользователя",
  "Модель предметной области",
  "Выбор технической основы",
  "Первый вертикальный срез",
  "Хранение данных",
  "Миграции без потери данных",
];
/** Гостевая доступность — то, что лежит в общем кеше: бесплатное открыто, остальное под замком. */
const materials = titles.map((title, index): MaterialPreview => ({
  materialId: `programme-material-${String(index + 1)}`,
  slug: `programme-material-${String(index + 1)}`,
  title,
  access: index < 2 ? "free" : "closed",
  availability: index < 2 ? "available" : "locked",
  format: "Гайд",
  formatSlug: "guide",
  summary: "",
  topic: "Platform",
  topicSlug: "platform",
  tags: [],
  productMemberships: [
    {
      name: "Создание Platform Inside",
      slug: "platform-inside",
      ordinal: index + 1,
    },
  ],
}));
const chapters = ["Основа продукта", "Данные и доступ"].map((name, index) => ({
  id: `programme-chapter-${String(index + 1)}`,
  name,
  summary: "",
  materialIds: materials
    .slice(index * 4, index * 4 + 4)
    .map(({ materialId }) => materialId ?? ""),
}));
const result = {
  chapters,
  discoveryKind: "product",
  kind: "ready",
  hasNext: false,
  reference: {
    id: "72000000-0000-4000-8000-000000000670",
    name: "Создание Platform Inside",
    slug: "platform-inside",
    summary: "От продуктовой идеи до работающего приложения.",
  },
  items: materials,
  relatedProduct: [],
  topics: [],
} satisfies PublishedProductResult;

function StagedProgramme({
  sequence,
  signedIn,
}: {
  readonly sequence: StagedLoading;
  readonly signedIn: boolean;
}) {
  return (
    <Suspense fallback={<ProductProgrammeLoading />}>
      <SharedPart sequence={sequence} signedIn={signedIn} />
    </Suspense>
  );
}

function SharedPart({
  sequence,
  signedIn,
}: {
  readonly sequence: StagedLoading;
  readonly signedIn: boolean;
}) {
  use(sequence.sharedPart);
  return (
    <Suspense
      fallback={
        <PendingProduct
          artifacts={{ artifacts: [], kind: "ready" }}
          result={result}
        />
      }
    >
      <PersonalPart sequence={sequence} signedIn={signedIn} />
    </Suspense>
  );
}

/** Участнику продукт открыт целиком; гость видит замки и приглашение к оплате. */
const memberResult = {
  ...result,
  items: materials.map((item) => ({
    ...item,
    availability: "available" as const,
  })),
} satisfies PublishedProductResult;

function PersonalPart({
  sequence,
  signedIn,
}: {
  readonly sequence: StagedLoading;
  readonly signedIn: boolean;
}) {
  use(sequence.personalPart);
  // Прогресс приходит контекстом, как от `ProductLearningSource` в `PersonalProduct`.
  return signedIn ? (
    <ProductLearningProvider
      learning={{
        kind: "ready",
        read: 1,
        total: materials.length,
        continuation: null,
      }}
    >
      <ProductProgrammeView
        productOffer={productOnlyOffer}
        productOpen
        result={memberResult}
      />
    </ProductLearningProvider>
  ) : (
    <ProductProgrammeView productOffer={productOnlyOffer} result={result} />
  );
}

interface ProgrammeGeometry {
  readonly back: Box;
  readonly header: Box;
  readonly firstRow: Box | null;
}

function measure(canvasElement: HTMLElement): ProgrammeGeometry {
  const firstRow = canvasElement.querySelector("[data-product-ordinal='1']");
  return {
    back: boxOf(canvasElement, "[data-programme-part='back']"),
    header: boxOf(canvasElement, "[data-programme-part='header']"),
    firstRow:
      firstRow === null
        ? null
        : boxOf(canvasElement, "[data-product-ordinal='1']"),
  };
}

const environment = publicPageEnvironment(
  "/products/platform-inside/programme",
);
const meta = {
  ...environment,
  component: ProductProgrammeView,
  id: "pages-product-programme-loading",
  title: "Pages/Product/Programme/Loading",
  parameters: {
    ...environment.parameters,
    docs: {
      description: {
        component:
          "Переход в программу: скелет маршрута, общая часть из гостевого кеша и личная часть встают на одно место (#670).",
      },
    },
  },
  args: { result },
} satisfies Meta<typeof ProductProgrammeView>;
export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Скелет, общая часть и готовая программа не имеют права двигать друг друга: ряд возврата и шапка
 * стоят на месте с первого кадра, а между общей частью и готовой программой на месте остаются ещё
 * высота шапки и первый урок. Расхождение между состояниями роняет историю.
 */
function loadsInPlace(
  { globals, width }: StoryViewport,
  signedIn: boolean,
): Pick<Story, "decorators" | "globals" | "loaders" | "render" | "play"> {
  return {
    globals,
    decorators: [
      (Story) => (
        <MaterialReadingScope
          value={{
            accountId: signedIn ? "story-account" : null,
            resolved: true,
            states: new Map(),
            register: () => () => undefined,
            refresh: () => Promise.resolve(),
            failed: false,
          }}
        >
          <Story />
        </MaterialReadingScope>
      ),
    ],
    loaders: stagedLoaders,
    render: (_args, { loaded }) => (
      <StagedProgramme sequence={stagedLoadingOf(loaded)} signedIn={signedIn} />
    ),
    play: async ({ canvasElement, loaded }) => {
      await settleStoryFrame(width);
      const sequence = stagedLoadingOf(loaded);
      const canvas = within(canvasElement);
      await expect(
        await canvas.findByLabelText("Программа загружается"),
      ).toHaveAttribute("aria-busy", "true");
      const skeleton = measure(canvasElement);

      sequence.deliverSharedPart();
      await canvas.findByRole("heading", {
        level: 1,
        name: "Создание Platform Inside",
      });
      await expect(
        canvasElement.querySelectorAll("[data-product-access-pending]").length,
      ).toBe(materials.length);
      const sharedPart = measure(canvasElement);

      sequence.deliverPersonalPart();
      if (signedIn)
        await canvas.findByRole("progressbar", { name: "Прогресс продукта" });
      else await canvas.findByRole("link", { name: "Приобрести доступ" });
      await expect(
        canvasElement.querySelector("[data-product-access-pending]"),
      ).toBeNull();
      const ready = measure(canvasElement);

      await expect(skeleton.back).toEqual(ready.back);
      await expect(originOf(skeleton.header)).toEqual(originOf(ready.header));
      await expect(sharedPart).toEqual(ready);
    },
  };
}

export const GuestLoadsInPlace: Story = { ...loadsInPlace(desktop, false) };
export const GuestLoadsInPlaceMobile: Story = {
  ...loadsInPlace(mobile, false),
};
export const MemberLoadsInPlace: Story = { ...loadsInPlace(desktop, true) };
export const MemberLoadsInPlaceMobile: Story = {
  ...loadsInPlace(mobile, true),
};

/** Набор на поток: вместо «Приобрести доступ» — цена предзаказа, зачёркнутая цена после старта и предзаказ. */
export const GuestPreorder: Story = {
  decorators: [
    (Story) => (
      <MaterialReadingScope
        value={{
          accountId: null,
          resolved: true,
          states: new Map(),
          register: () => () => undefined,
          refresh: () => Promise.resolve(),
          failed: false,
        }}
      >
        <Story />
      </MaterialReadingScope>
    ),
  ],
  args: {
    result,
    productOffer: productOnlyOffer,
    preorder: {
      price: "29 900 ₽",
      priceAfterStart: "39 900 ₽",
      startsOn: "9 ноября",
      daysLeft: "до старта 31 день",
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      await canvas.findByRole("link", { name: "Оформить предзаказ" }),
    ).toBeVisible();
    await expect(canvas.getByText("39 900 ₽")).toBeInTheDocument();
    // Срок — наклейкой на углу шапки: сколько дней до старта, а не дата словами.
    await expect(canvas.getByText("до старта 31 день")).toBeVisible();
  },
};
export const GuestPreorderMobile: Story = {
  ...GuestPreorder,
  globals: mobile.globals,
};
