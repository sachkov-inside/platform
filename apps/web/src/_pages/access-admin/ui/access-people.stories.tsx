import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";

import { PeopleView } from "@/features/billing-admin";
import {
  noPeopleFilters,
  type AccessHolder,
  type PersonGround,
} from "@/features/billing-admin/model/access-operations";
import type { Invitation } from "@/features/billing-admin/model/invitation-operations";
import {
  authoringPageEnvironment,
  routeContent,
} from "@/workshop/story-environment";

import { AccessSection } from "./access-section.client";

const environment = authoringPageEnvironment("/authoring/access");
const uuid = (value: string) =>
  `00000000-0000-4000-8000-${value.padStart(12, "0")}`;
const subscription = { id: uuid("101"), name: "Подписка Inside" };
const course = { id: uuid("103"), name: "Курс" };
const guide = { id: uuid("104"), name: "Руководство" };

function ground(
  id: string,
  overrides: Partial<PersonGround> = {},
): PersonGround {
  return {
    kind: "enrollment",
    id: uuid(id),
    revision: 1,
    source: "platform_payment",
    offer: subscription,
    capabilities: ["community", "materials"],
    purchaseRef: null,
    startsAt: "2030-03-01T00:00:00.000Z",
    endsAt: "2030-04-01T21:00:00.000Z",
    revokedAt: null,
    endPolicy: "fixed",
    state: "active",
    ...overrides,
  };
}

/** Только выдуманные Account и Telegram: настоящие люди живут в production БД. */
const people: readonly AccessHolder[] = [
  {
    accountId: uuid("c01"),
    telegramIdentityRef: "telegram:synthetic-01",
    grounds: [ground("d01")],
  },
  {
    accountId: uuid("c02"),
    telegramIdentityRef: null,
    grounds: [ground("d02", { source: "invitation", endsAt: null })],
  },
  {
    accountId: uuid("c03"),
    telegramIdentityRef: "telegram:synthetic-03",
    grounds: [ground("d03", { source: "course", offer: course, endsAt: null })],
  },
  {
    accountId: uuid("c04"),
    telegramIdentityRef: "telegram:synthetic-04",
    grounds: [
      ground("d04", {
        source: "manual",
        state: "ended",
        endsAt: "2030-03-01T21:00:00.000Z",
      }),
      ground("d05", {
        kind: "grant",
        source: "manual",
        offer: null,
        capabilities: ["community"],
        endPolicy: null,
      }),
    ],
  },
  {
    accountId: uuid("c05"),
    telegramIdentityRef: null,
    grounds: [
      ground("d06", {
        kind: "grant",
        source: "one_time_purchase",
        offer: guide,
        capabilities: ["materials"],
        purchaseRef: uuid("e01"),
        endsAt: null,
        endPolicy: null,
      }),
    ],
  },
  {
    accountId: uuid("c06"),
    telegramIdentityRef: null,
    grounds: [
      ground("d07", {
        source: "tribute",
        state: "revoked",
        revokedAt: "2030-03-10T09:00:00.000Z",
        endPolicy: "confirmed_external",
      }),
    ],
  },
];

const gift: Invitation = {
  id: uuid("e09"),
  code: "Syn7heticGift",
  startParameter: "i_Syn7heticGift",
  offerId: subscription.id,
  offerRevision: 1,
  mode: "gift",
  giftMonths: 3,
  state: "issued",
  issuedAt: "2030-03-15T09:00:00.000Z",
  expiresAt: "2030-03-29T09:00:00.000Z",
  claimedAt: null,
  redeemedAt: null,
  revokedAt: null,
  accountId: null,
  revision: 1,
  link: "https://t.me/synthetic_inside_bot?start=i_Syn7heticGift",
};

const meta = {
  ...environment,
  title: "Pages/Authoring/Access people",
  component: PeopleView,
  render: (args) => (
    <AccessSection
      tabs={[
        {
          id: "people",
          label: "Люди и доступ",
          panel: <PeopleView {...args} />,
        },
      ]}
    />
  ),
  args: {
    offers: [subscription, course, guide],
    assignable: [subscription, course],
    people,
    loading: false,
    error: null,
    hasMore: false,
    loadingMore: false,
    filters: noPeopleFilters,
    busy: false,
    message: "",
    failure: null,
    gift: null,
    onFiltersChange: fn(),
    onLoadMore: fn(),
    onChangeGround: fn(),
    onAssign: fn(),
    onGift: fn(),
    onCopy: fn(),
  },
  parameters: {
    ...environment.parameters,
    docs: {
      description: {
        component:
          "Раздел «Доступ», вкладка «Люди и доступ»: основания каждого человека с источником и " +
          "сроком. Карточка продлевает, отзывает, назначает и дарит доступ.",
      },
    },
  },
} satisfies Meta<typeof PeopleView>;
export default meta;
type Story = StoryObj<typeof meta>;

function person(canvas: HTMLElement, id: string) {
  return within(
    routeContent(canvas).getByRole("listitem", { name: `Account ${uuid(id)}` }),
  );
}

/** Все источники подписаны словами владельца, срок назван последним днём по Москве. */
export const EverySource: Story = {
  args: { hasMore: true },
  play: async ({ args, canvasElement }) => {
    const page = routeContent(canvasElement);
    await expect(
      page.getAllByRole("listitem", { name: /^Account / }),
    ).toHaveLength(6);
    for (const label of [
      "Оплата подписки",
      "Подарок по приглашению",
      "Курс",
      "Решение владельца",
      "Разовая покупка",
      "Tribute",
    ])
      await expect(
        page.getAllByText(new RegExp(label, "u")).length,
      ).toBeGreaterThan(0);
    await expect(
      person(canvasElement, "c01").getByText(
        /до 1 апр\. 2030 г\. включительно/u,
      ),
    ).toBeVisible();
    await expect(
      person(canvasElement, "c02").getByText("Telegram не привязан"),
    ).toBeVisible();
    await userEvent.selectOptions(
      page.getByLabelText("Источник"),
      "invitation",
    );
    await expect(args.onFiltersChange).toHaveBeenCalledWith({
      ...noPeopleFilters,
      source: "invitation",
    });
    await userEvent.selectOptions(page.getByLabelText("Состояние"), "expiring");
    await expect(args.onFiltersChange).toHaveBeenCalledWith({
      ...noPeopleFilters,
      state: "expiring",
    });
    await userEvent.click(page.getByRole("button", { name: "Показать ещё" }));
    await expect(args.onLoadMore).toHaveBeenCalled();
  },
};

/** Карточка продлевает назначение до выбранного дня и отзывает ручное право. */
export const CardActions: Story = {
  play: async ({ args, canvasElement }) => {
    const paying = person(canvasElement, "c01");
    await userEvent.click(paying.getByText(uuid("c01")));
    await expect(
      paying.getByText(/Оплаченную подписку меняют отмена продления/u),
    ).toBeVisible();
    const giftee = person(canvasElement, "c02");
    await userEvent.click(giftee.getByText(uuid("c02")));
    const form = within(
      giftee.getByRole("group", {
        name: "Подписка Inside · Подарок по приглашению",
      }),
    );
    await expect(form.getByLabelText("Доступ до")).toHaveValue("");
    await userEvent.type(form.getByLabelText("Доступ до"), "2030-05-31");
    await userEvent.type(
      form.getByLabelText("Причина"),
      "Продление по просьбе",
    );
    await userEvent.click(form.getByRole("button", { name: "Изменить срок" }));
    await expect(args.onChangeGround).toHaveBeenCalledWith({
      ground: people[1]?.grounds[0],
      action: "extend",
      until: "2030-05-31",
      reason: "Продление по просьбе",
    });

    const manual = person(canvasElement, "c04");
    await userEvent.click(manual.getByText(uuid("c04")));
    // Закончившееся назначение можно продлить: срок назначают заново той же формой.
    await expect(
      manual.getByRole("group", {
        name: "Подписка Inside · Решение владельца",
      }),
    ).toBeVisible();
    const grant = within(
      manual.getByRole("group", { name: "community · Решение владельца" }),
    );
    await userEvent.type(grant.getByLabelText("Причина"), "Ошибка выдачи");
    await userEvent.click(grant.getByRole("button", { name: "Отозвать" }));
    await expect(args.onChangeGround).toHaveBeenCalledWith({
      ground: people[3]?.grounds[1],
      action: "revoke",
      until: null,
      reason: "Ошибка выдачи",
    });

    const buyer = person(canvasElement, "c05");
    await userEvent.click(buyer.getByText(uuid("c05")));
    await expect(buyer.getByText(/меняет только возврат/u)).toBeVisible();

    const revoked = person(canvasElement, "c06");
    await userEvent.click(revoked.getByText(uuid("c06")));
    await expect(
      revoked.getByRole("button", { name: "Восстановить" }),
    ).toBeVisible();
  },
};

/** Из карточки назначают тариф без оплаты и выдают подарочное приглашение. */
export const AssignAndGift: Story = {
  play: async ({ args, canvasElement }) => {
    const card = person(canvasElement, "c02");
    await userEvent.click(card.getByText(uuid("c02")));
    const assign = within(card.getByRole("group", { name: "Назначить тариф" }));
    await userEvent.selectOptions(
      assign.getByLabelText("Тариф для назначения"),
      course.id,
    );
    await userEvent.type(
      assign.getByLabelText("Причина назначения"),
      "Ученик курса",
    );
    await userEvent.click(
      assign.getByRole("button", { name: "Назначить без оплаты" }),
    );
    await expect(args.onAssign).toHaveBeenCalledWith({
      accountId: uuid("c02"),
      offerId: course.id,
      until: null,
      reason: "Ученик курса",
    });
    const giftForm = within(
      card.getByRole("group", { name: "Подарочное приглашение" }),
    );
    await userEvent.selectOptions(
      giftForm.getByLabelText("Тариф в подарок"),
      subscription.id,
    );
    await userEvent.type(giftForm.getByLabelText("Месяцев подарка"), "3");
    await userEvent.click(
      giftForm.getByRole("button", { name: "Выдать подарочное приглашение" }),
    );
    await expect(args.onGift).toHaveBeenCalledWith({
      accountId: uuid("c02"),
      offerId: subscription.id,
      giftMonths: 3,
      note: `Account ${uuid("c02")}`,
    });
  },
};

/** Выданная ссылка видна в карточке того, кому её выдали. */
export const GiftIssued: Story = {
  args: {
    gift: { accountId: uuid("c02"), invitation: gift },
    message: "Подарочное приглашение готово.",
  },
  play: async ({ args, canvasElement }) => {
    const card = person(canvasElement, "c02");
    await userEvent.click(card.getByText(uuid("c02")));
    await expect(card.getByText(gift.link ?? "")).toBeVisible();
    await userEvent.click(
      card.getByRole("button", { name: "Скопировать ссылку" }),
    );
    await expect(args.onCopy).toHaveBeenCalledWith(gift.link);
  },
};

export const ChangeRefused: Story = {
  args: {
    failure:
      "Доступ изменился, пока была открыта карточка. Список обновлён — проверьте и повторите.",
  },
};

export const NobodyMatches: Story = {
  args: { people: [], filters: { ...noPeopleFilters, source: "tribute" } },
  play: async ({ canvasElement }) => {
    await expect(
      routeContent(canvasElement).getByText(
        "Под эти фильтры никто не подходит.",
      ),
    ).toBeVisible();
  },
};

export const ListUnavailable: Story = {
  args: {
    people: [],
    error: "Данные оплаты сейчас недоступны. Повторите позже.",
  },
};

export const Mobile: Story = {
  globals: { viewport: { isRotated: false, value: "mobile390" } },
};
export const Desktop: Story = {
  globals: { viewport: { isRotated: false, value: "desktop1440" } },
};
