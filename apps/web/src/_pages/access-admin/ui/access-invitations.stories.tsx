import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";

import { InvitationsView } from "@/features/billing-admin";
import type { Invitation } from "@/features/billing-admin/model/invitation-operations";
import {
  billingOffers,
  materialsOffer,
  supportOffer,
} from "@/storybook/billing.fixtures";
import {
  authoringPageEnvironment,
  routeContent,
} from "@/storybook/story-environment";

import { AccessSection } from "./access-section.client";

const environment = authoringPageEnvironment("/authoring/access");
const uuid = (value: string) =>
  `00000000-0000-4000-8000-${value.padStart(12, "0")}`;

/** Только выдуманные коды и бот: настоящие приглашения живут в production БД. */
function invitation(
  id: string,
  overrides: Partial<Invitation> = {},
): Invitation {
  const code = `Syn7hetic${id}`;
  return {
    id: uuid(id),
    code,
    startParameter: `i_${code}`,
    offerId: materialsOffer.offer.id,
    offerRevision: 3,
    mode: "purchase",
    giftMonths: null,
    note: null,
    state: "issued",
    issuedAt: "2030-04-01T09:00:00.000Z",
    expiresAt: "2030-04-15T09:00:00.000Z",
    claimedAt: null,
    redeemedAt: null,
    revokedAt: null,
    accountId: null,
    revision: 1,
    link: `https://t.me/synthetic_inside_bot?start=i_${code}`,
    ...overrides,
  };
}

const everyState: readonly Invitation[] = [
  invitation("e01", { note: "Гость эфира, оплата со скидкой" }),
  invitation("e02", {
    mode: "gift",
    giftMonths: 3,
    offerId: supportOffer.offer.id,
    state: "claimed",
    claimedAt: "2030-04-02T10:00:00.000Z",
    revision: 2,
  }),
  invitation("e03", {
    state: "redeemed",
    claimedAt: "2030-04-02T10:00:00.000Z",
    redeemedAt: "2030-04-02T10:05:00.000Z",
    accountId: uuid("c01"),
    revision: 3,
  }),
  invitation("e04", {
    mode: "gift",
    state: "redeemed",
    claimedAt: "2030-04-03T10:00:00.000Z",
    redeemedAt: "2030-04-03T10:00:00.000Z",
    accountId: uuid("c02"),
    revision: 3,
  }),
  invitation("e05", { state: "expired", revision: 2 }),
  invitation("e06", {
    state: "revoked",
    revokedAt: "2030-04-04T12:00:00.000Z",
    revision: 2,
    link: null,
  }),
];

const meta = {
  ...environment,
  title: "Pages/Authoring/Access invitations",
  component: InvitationsView,
  render: (args) => (
    <AccessSection
      tabs={[
        {
          id: "invitations",
          label: "Приглашения",
          panel: <InvitationsView {...args} />,
        },
      ]}
    />
  ),
  args: {
    offers: billingOffers,
    invitations: everyState,
    loading: false,
    error: null,
    filter: "all",
    hasMore: false,
    loadingMore: false,
    busy: false,
    issued: null,
    message: "",
    failure: null,
    onFilterChange: fn(),
    onLoadMore: fn(),
    onIssue: fn(),
    onRevoke: fn(),
    onCopy: fn(),
  },
  parameters: {
    ...environment.parameters,
    docs: {
      description: {
        component:
          "Раздел «Доступ», вкладка «Приглашения»: личная ссылка на бота открывает оплату " +
          "предложения или дарит доступ. Отзыв доступен, пока приглашение не использовано.",
      },
    },
  },
} satisfies Meta<typeof InvitationsView>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Пустой список зовёт выдать первое приглашение; подарок раскрывает срок. */
export const Empty: Story = {
  args: { invitations: [] },
  play: async ({ args, canvasElement }) => {
    const page = routeContent(canvasElement);
    await expect(
      page.getByRole("tab", { name: "Приглашения", selected: true }),
    ).toBeVisible();
    await expect(page.getByText(/Приглашений пока нет/u)).toBeVisible();
    await expect(page.queryByLabelText("Месяцев")).not.toBeInTheDocument();
    await userEvent.selectOptions(
      page.getByLabelText("Предложение"),
      supportOffer.offer.id,
    );
    await userEvent.click(page.getByRole("radio", { name: /Подарок/u }));
    await userEvent.type(page.getByLabelText("Месяцев"), "6");
    await userEvent.type(page.getByLabelText("Заметка"), "Гость эфира");
    await userEvent.click(
      page.getByRole("button", { name: "Создать приглашение" }),
    );
    await expect(args.onIssue).toHaveBeenCalledWith({
      offerId: supportOffer.offer.id,
      mode: "gift",
      giftMonths: 6,
      note: "Гость эфира",
    });
  },
};

/** Бессрочный подарок не отправляет срок. */
export const UnlimitedGift: Story = {
  args: { invitations: [] },
  play: async ({ args, canvasElement }) => {
    const page = routeContent(canvasElement);
    await userEvent.selectOptions(
      page.getByLabelText("Предложение"),
      materialsOffer.offer.id,
    );
    await userEvent.click(page.getByRole("radio", { name: /Подарок/u }));
    await userEvent.click(page.getByRole("checkbox", { name: "Бессрочно" }));
    await expect(page.queryByLabelText("Месяцев")).not.toBeInTheDocument();
    await userEvent.click(
      page.getByRole("button", { name: "Создать приглашение" }),
    );
    await expect(args.onIssue).toHaveBeenCalledWith({
      offerId: materialsOffer.offer.id,
      mode: "gift",
      giftMonths: null,
      note: null,
    });
  },
};

/** Каждое состояние подписано словами владельца; отозвать можно только выданное и открытое. */
export const EveryState: Story = {
  args: { hasMore: true },
  play: async ({ args, canvasElement }) => {
    const page = routeContent(canvasElement);
    const rows = page.getAllByRole("listitem");
    await expect(rows).toHaveLength(6);
    for (const label of [
      "Выдано",
      "Открыто",
      "Оплата открыта",
      "Подарено",
      "Сгорело",
      "Отозвано",
    ])
      await expect(
        page.getByRole("listitem", { name: new RegExp(`: ${label}$`, "u") }),
      ).toBeVisible();
    await expect(page.getByText("Подарок · 3 мес.")).toBeVisible();
    await expect(page.getByText("Подарок · Бессрочно")).toBeVisible();
    await expect(
      page.getByText("Гость эфира, оплата со скидкой"),
    ).toBeVisible();
    await expect(
      page.getAllByRole("button", { name: "Отозвать" }),
    ).toHaveLength(2);
    const claimed = within(page.getByRole("listitem", { name: /: Открыто$/u }));
    await userEvent.click(claimed.getByRole("button", { name: "Отозвать" }));
    await expect(args.onRevoke).toHaveBeenCalledWith(everyState[1]);
    const revoked = within(
      page.getByRole("listitem", { name: /: Отозвано$/u }),
    );
    await userEvent.click(
      revoked.getByRole("button", { name: "Скопировать параметр" }),
    );
    await expect(args.onCopy).toHaveBeenCalledWith("i_Syn7hetice06");
    await userEvent.click(page.getByRole("button", { name: "Сгорело" }));
    await expect(args.onFilterChange).toHaveBeenCalledWith("expired");
    await userEvent.click(page.getByRole("button", { name: "Показать ещё" }));
    await expect(args.onLoadMore).toHaveBeenCalled();
  },
};

/** Новая ссылка видна сразу и копируется одной кнопкой. */
export const Issued: Story = {
  args: {
    issued: invitation("e07", { mode: "gift", giftMonths: 12 }),
    message: "Скопировано.",
  },
  play: async ({ args, canvasElement }) => {
    const page = routeContent(canvasElement);
    const link = "https://t.me/synthetic_inside_bot?start=i_Syn7hetice07";
    await expect(page.getByText(link)).toBeVisible();
    await expect(page.getByText(/Приглашение готово: подарок/u)).toBeVisible();
    const panel = within(
      canvasElement.querySelector<HTMLElement>("[data-issued-invitation]") ??
        canvasElement,
    );
    await userEvent.click(
      panel.getByRole("button", { name: "Скопировать ссылку" }),
    );
    await expect(args.onCopy).toHaveBeenCalledWith(link);
  },
};

/** Без имени бота владелец получает параметр запуска вместо ссылки. */
export const IssuedWithoutBotName: Story = {
  args: { issued: invitation("e08", { link: null }) },
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await expect(page.getByText("i_Syn7hetice08")).toBeVisible();
    await expect(page.getByText(/Имя бота не настроено/u)).toBeVisible();
  },
};

/** Отказ отзыва объясняется словами владельца над списком. */
export const RevokeRefused: Story = {
  args: {
    failure:
      "Это приглашение уже использовано или сгорело: отозвать его нельзя. Список обновлён.",
  },
  play: async ({ canvasElement }) => {
    await expect(
      routeContent(canvasElement).getByRole("alert"),
    ).toHaveTextContent(/отозвать его нельзя/u);
  },
};

export const ListUnavailable: Story = {
  args: {
    invitations: [],
    error: "Данные оплаты сейчас недоступны. Повторите позже.",
  },
};

export const Mobile: Story = {
  args: { issued: invitation("e07") },
  globals: { viewport: { isRotated: false, value: "mobile390" } },
};
export const Desktop: Story = {
  args: { issued: invitation("e07") },
  globals: { viewport: { isRotated: false, value: "desktop1440" } },
};
