import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import {
  billingOffers,
  materialsOffer,
  supportOffer,
} from "@/storybook/billing.fixtures";
import { authoringPageEnvironment } from "@/storybook/story-environment";

import { BillingAdminPanel } from "./billing-admin-panel.client";
import {
  billingBeforeRender,
  billingNeverAnswers,
  billingOk,
  billingRefused,
  billingRequests,
  type BillingRoutes,
} from "./billing-bff.fixtures";

const environment = authoringPageEnvironment("/authoring/billing");
const accountId = "00000000-0000-4000-8000-0000000000c1";
const purchaseRef = "00000000-0000-4000-8000-0000000000b1";
const productId = "62000000-0000-4000-8000-000000000814";

const content = [
  {
    kind: "product",
    id: productId,
    title: "AI Engineering",
    slug: "ai-engineering",
    available: true,
  },
  {
    kind: "product",
    id: "62000000-0000-4000-8000-000000000004",
    title: "Инженерная практика",
    slug: "engineering-practice",
    available: true,
  },
] as const;

/** Тариф, который владелец назначает без продажи: каталог подписывает его «назначается». */
const assignmentOnlyTier = {
  tier: {
    id: "62000000-0000-4000-8000-000000000003",
    revision: 2,
    name: "Подписка Inside",
    benefits: ["materials", "community"],
    coverage: {
      productIds: ["62000000-0000-4000-8000-000000000004"],
      materialIds: [],
    },
  },
  availableForAssignment: true,
  published: false,
  archived: false,
};

/** Чтения, которые страница делает сразу: каталог содержимого, тарифы и панели разделов. */
const billingReads: BillingRoutes = {
  "content/list": billingOk({ outcome: "content", items: content }),
  "tiers/list": billingOk({
    outcome: "tiers",
    items: [assignmentOnlyTier],
    nextCursor: null,
  }),
  "activation-rules/list": billingOk({
    outcome: "activationRules",
    items: [],
  }),
  "tribute/status": billingOk({
    outcome: "tributeStatus",
    value: {
      page: 0,
      hasMore: false,
      imports: [],
      policies: [],
      unconfirmedSources: [],
      sources: [],
      inbox: [],
      metrics: {
        unresolvedImports: 0,
        pendingIdentity: 0,
        unresolvedEvents: 0,
        temporarySources: 0,
        staleConfirmations: 0,
        rolloutBlocked: false,
      },
    },
  }),
  "respondents/status": billingOk({
    outcome: "respondents",
    value: { total: 0, issued: 0, purchased: 0, respondents: [] },
  }),
};

function withReplies(routes: BillingRoutes) {
  return billingBeforeRender({ ...billingReads, ...routes });
}

const meta = {
  ...environment,
  beforeEach: [environment.beforeEach, withReplies({})],
  title: "Pages/Authoring/Billing",
  component: BillingAdminPanel,
  args: {
    offers: billingOffers,
    cohorts: [
      {
        productId,
        revision: 3,
        name: "Поток 1",
        stage: "preorder",
        startsOn: "2026-10-20",
        nextEvent: "",
        priceAfterStartKopecks: 3_990_000,
      },
    ],
  },
  parameters: {
    ...environment.parameters,
    docs: {
      description: {
        component:
          "Раздел «Оплата и права» в production-составе: назначения, ссылки активации, перенос из " +
          "Tribute, каталог, потоки, скидка респондентам, платежи и права. Панели читают и пишут " +
          "через подменённый BFF billing.",
      },
    },
  },
} satisfies Meta<typeof BillingAdminPanel>;
export default meta;
type Story = StoryObj<typeof meta>;

function lastRequest(route: string): unknown {
  const call = billingRequests.mock.calls.findLast(([name]) => name === route);
  return call?.[1];
}

/** Разделы идут в порядке production; каталог прочитан и оба тарифа в продаже. */
export const Catalog: Story = {
  globals: { viewport: { isRotated: false, value: "desktop1440" } },
  play: async ({ canvasElement }) => {
    const page = within(canvasElement);
    await expect(
      page.getByRole("heading", { level: 1, name: "Оплата и права" }),
    ).toBeVisible();
    const sections = [
      "Тарифы и назначения",
      "Ссылки активации курса",
      "Подтверждение до регистрации",
      "Перенос доступа из Tribute",
      "Действующий каталог",
      "Поток продукта",
      "Скидка респондентам анкеты",
      "Платежи",
      "Кто этот покупатель",
      "Права участника",
    ];
    const headings = sections.map((name) =>
      page.getByRole("heading", { name }),
    );
    for (const [index, heading] of headings.entries()) {
      const next = headings[index + 1];
      if (next === undefined) break;
      await expect(
        heading.compareDocumentPosition(next) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }
    await expect(page.getAllByText("В продаже")).toHaveLength(2);
    await expect(
      page.getAllByRole("button", { name: "Снять с продажи" }),
    ).toHaveLength(2);
    await expect(
      await page.findByText("Подписка Inside · назначается"),
    ).toBeVisible();
    await expect(
      page.getByRole("checkbox", { name: "Продукт: Инженерная практика" }),
    ).toBeInTheDocument();

    const main = page.getByRole("main");
    const skipLink = page.getByRole("link", { name: "Перейти к содержанию" });
    await expect(skipLink).toHaveAttribute("href", `#${main.id}`);
    main.focus();
    await expect(main).toHaveFocus();

    const lastSection = page.getByRole("heading", { name: "Права участника" });
    await expect(lastSection.getBoundingClientRect().top).toBeGreaterThan(
      main.getBoundingClientRect().bottom,
    );
    await expect(getComputedStyle(main).overflowY).toBe("auto");
    lastSection.scrollIntoView({ block: "start" });
    await expect(main.scrollTop).toBeGreaterThan(0);
    await expect(
      lastSection.getBoundingClientRect().top,
    ).toBeGreaterThanOrEqual(main.getBoundingClientRect().top);
    await expect(
      lastSection.getBoundingClientRect().bottom,
    ).toBeLessThanOrEqual(main.getBoundingClientRect().bottom);
    main.scrollTop = 0;
  },
};

export const CatalogNotOnSale: Story = {
  args: {
    offers: billingOffers.map((snapshot) => ({
      ...snapshot,
      offer: { ...snapshot.offer, published: false },
    })),
  },
  play: async ({ canvasElement }) => {
    const page = within(canvasElement);
    await expect(page.getAllByText("Не продаётся")).toHaveLength(2);
    await expect(
      page.getAllByRole("button", { name: "Вернуть в продажу" }),
    ).toHaveLength(2);
  },
};

/** Один из двух тарифов продаётся: тумблеры независимы, снятие подтверждается сообщением. */
export const SaleToggled: Story = {
  args: {
    offers: [
      materialsOffer,
      { ...supportOffer, offer: { ...supportOffer.offer, published: false } },
    ],
  },
  beforeEach: withReplies({
    "offers/unpublish": billingOk({
      outcome: "catalog",
      value: {
        id: materialsOffer.offer.id,
        revision: materialsOffer.offer.revision + 1,
        archived: false,
        published: false,
      },
    }),
  }),
  play: async ({ canvasElement }) => {
    const page = within(canvasElement);
    await expect(page.getAllByText("В продаже")).toHaveLength(1);
    await userEvent.click(
      page.getByRole("button", { name: "Снять с продажи" }),
    );
    await expect(
      await page.findByText("Предложение снято с продажи."),
    ).toBeVisible();
    await expect(page.getAllByText("Не продаётся")).toHaveLength(2);
    await expect(lastRequest("offers/unpublish")).toMatchObject({
      id: materialsOffer.offer.id,
      expectedRevision: materialsOffer.offer.revision,
    });
  },
};

/** Отказ команды показан над разделами словами владельца. */
export const CommandRefused: Story = {
  beforeEach: withReplies({
    "offers/unpublish": billingRefused("revision_conflict"),
  }),
  play: async ({ canvasElement }) => {
    const page = within(canvasElement);
    const [first] = page.getAllByRole("button", { name: "Снять с продажи" });
    if (first === undefined) throw new Error("Каталог без тумблера продажи");
    await userEvent.click(first);
    await expect(
      await page.findByText(
        "Подписка изменилась в другом месте. Обновите данные и повторите действие.",
      ),
    ).toBeVisible();
    await expect(page.getAllByText("В продаже")).toHaveLength(2);
  },
};

export const CatalogLoading: Story = {
  beforeEach: withReplies({ "content/list": billingNeverAnswers }),
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByText("Загружаем каталог…"),
    ).toBeVisible();
  },
};

export const PermissionDenied: Story = {
  args: { offers: [], cohorts: null },
  beforeEach: withReplies({
    "content/list": billingRefused("forbidden"),
    "tiers/list": billingRefused("forbidden"),
  }),
  play: async ({ canvasElement }) => {
    const page = within(canvasElement);
    const notices = await page.findAllByText(
      "У вас нет права на это действие.",
    );
    for (const notice of notices) await expect(notice).toBeVisible();
    await expect(
      page.queryByText("Сессия завершилась. Войдите снова."),
    ).not.toBeInTheDocument();
  },
};

export const CatalogUnavailable: Story = {
  beforeEach: withReplies({ "content/list": billingRefused("unavailable") }),
  play: async ({ canvasElement }) => {
    const catalog = within(
      within(canvasElement)
        .getByRole("heading", { name: "Предложение" })
        .closest("section") ?? canvasElement,
    );
    await expect(await catalog.findByRole("alert")).toBeVisible();
  },
};

/** Поток продукта: владелец переключает этап и дату, команда уходит с текущей редакцией. */
export const ProductCohort: Story = {
  beforeEach: withReplies({
    "cohorts/save": billingOk({
      outcome: "catalog",
      value: { id: productId, revision: 4, archived: false },
    }),
  }),
  play: async ({ canvasElement }) => {
    const page = within(canvasElement);
    await expect(
      await page.findByText(/AI Engineering · Поток 1 · Предзаказ до старта/u),
    ).toBeVisible();
    await userEvent.click(page.getByRole("button", { name: "Изменить" }));
    await expect(page.getByLabelText("Название потока")).toHaveValue("Поток 1");
    await expect(page.getByLabelText("Цена после старта, ₽")).toHaveValue(
      "39900",
    );
    await userEvent.click(
      page.getByRole("button", { name: "Сохранить поток" }),
    );
    await waitFor(() =>
      expect(lastRequest("cohorts/save")).toMatchObject({
        expectedRevision: 3,
        value: {
          productId,
          name: "Поток 1",
          stage: "preorder",
          priceAfterStartKopecks: 3_990_000,
        },
      }),
    );
  },
};

/** Цена после старта не положительна: форма объясняет ошибку и не отправляет поток. */
export const ProductCohortInvalidPriceAfterStart: Story = {
  play: async ({ canvasElement }) => {
    const page = within(canvasElement);
    await userEvent.click(
      await page.findByRole("button", { name: "Изменить" }),
    );
    const price = page.getByLabelText("Цена после старта, ₽");
    await userEvent.clear(price);
    await userEvent.type(price, "-100");
    await userEvent.click(
      page.getByRole("button", { name: "Сохранить поток" }),
    );
    await expect(
      await page.findByText(
        /Цена после старта — положительная сумма в рублях/u,
      ),
    ).toBeVisible();
    await expect(price).toHaveAttribute("aria-invalid", "true");
  },
};

/** Потоки не прочитаны: раздел говорит об этом и не даёт сохранить поток без текущей редакции. */
export const ProductCohortUnavailable: Story = {
  args: { cohorts: null },
  play: async ({ canvasElement }) => {
    const page = within(canvasElement);
    await expect(
      page.getByText(/Не удалось прочитать текущие потоки/u),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Сохранить поток" }),
    ).toBeDisabled();
  },
};

export const Payments: Story = {
  beforeEach: withReplies({
    "payments/list": billingOk({
      outcome: "payments",
      items: [
        {
          purchaseRef,
          accountId,
          kind: "initial",
          state: "confirmed",
          subscriptionRef: null,
          periodIndex: 1,
          amountKopecks: 280_000,
          environment: "demo",
          terminalRef: "demo-terminal",
          paymentId: "8811",
          snapshot: supportOffer,
          fiscalization: "confirmed",
          confirmedAt: "2026-09-01T09:05:00.000Z",
          periodEndsAt: "2026-10-01T09:05:00.000Z",
          createdAt: "2026-09-01T09:00:00.000Z",
          updatedAt: "2026-09-01T09:05:00.000Z",
          access: "ready",
          refundedKopecks: 0,
          refundableKopecks: 280_000,
        },
      ],
      nextCursor: purchaseRef,
    }),
  }),
  play: async ({ canvasElement }) => {
    const page = within(canvasElement);
    await userEvent.click(
      page.getByRole("button", { name: "Показать платежи" }),
    );
    const table = await page.findByRole("table", { name: "Платежи" });
    await expect(within(table).getAllByRole("row")).toHaveLength(2);
    await expect(lastRequest("payments/list")).toMatchObject({ limit: 50 });
  },
};

/** Нераспознанный покупатель: подписка ему недоступна, пока владелец не примет решение. */
export const ClassificationUnknown: Story = {
  beforeEach: withReplies({
    "grants/read-classification": billingOk({
      outcome: "classification",
      value: {
        accountId,
        classification: "unknown",
        revision: 0,
        recurringAllowed: false,
      },
    }),
  }),
  play: async ({ canvasElement }) => {
    const section = within(
      within(canvasElement)
        .getByRole("heading", { name: "Кто этот покупатель" })
        .closest("section") ?? canvasElement,
    );
    await userEvent.type(section.getByLabelText("Account"), accountId);
    await userEvent.click(
      section.getByRole("button", { name: "Показать состояние" }),
    );
    await expect(
      await section.findByText("неизвестно · автосписания запрещены"),
    ).toBeVisible();
    await expect(
      section.getByRole("button", { name: "Записать решение" }),
    ).toBeEnabled();
  },
};

/** Предпросмотр массовой выдачи: применяются только подтверждённые строки. */
export const GrantPreview: Story = {
  beforeEach: withReplies({
    "grants/preview-batch": billingOk({
      outcome: "grantPreview",
      previewRef: "00000000-0000-4000-8000-0000000000d1",
      revision: 1,
      expiresAt: "2026-09-10T11:00:00.000Z",
      rows: [
        { rowKey: "row-1", accountId, status: "confirmed" },
        { rowKey: "row-2", accountId, status: "not_found" },
      ],
    }),
  }),
  play: async ({ canvasElement }) => {
    const section = within(
      within(canvasElement)
        .getByRole("heading", { name: "Массовая выдача и классификация" })
        .closest("section") ?? canvasElement,
    );
    const rows = [
      `row-1 | ${accountId} | unknown | survey-1 | 0 | нет | нет | Анкета`,
      `row-2 | ${accountId} | unknown | survey-2 | 0 | нет | нет | Анкета`,
    ].join("\n");
    await userEvent.click(section.getByLabelText("Строки"));
    await userEvent.paste(rows);
    await userEvent.click(
      section.getByRole("button", { name: "Собрать предпросмотр" }),
    );
    await expect(await section.findByText("row-2 · не найден")).toBeVisible();
    await expect(
      section.getByRole("button", { name: "Применить подтверждённые строки" }),
    ).toBeEnabled();
  },
};

export const Mobile: Story = {
  globals: { viewport: { isRotated: false, value: "mobile390" } },
  play: async ({ canvasElement }) => {
    const page = within(canvasElement);
    await expect(
      page.getByRole("heading", { level: 1, name: "Оплата и права" }),
    ).toBeVisible();
    await expect(
      canvasElement.ownerDocument.documentElement.scrollWidth,
    ).toBeLessThanOrEqual(
      canvasElement.ownerDocument.documentElement.clientWidth,
    );
  },
};
