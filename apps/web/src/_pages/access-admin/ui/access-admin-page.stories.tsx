import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import {
  billingBeforeRender,
  billingNeverAnswers,
  billingOk,
  billingRefused,
  billingRequests,
  type BillingRoutes,
} from "@/features/billing-admin/ui/billing-bff.fixtures";
import {
  guideOnlyOffer,
  materialsOffer,
  supportOffer,
} from "@/storybook/billing.fixtures";
import {
  authoringPageEnvironment,
  routeContent,
} from "@/storybook/story-environment";

import {
  accessOffers,
  accessPeople,
  accessReads,
  accessSummary,
  everyStateInvitations,
  invitation,
  invitationsReply,
  issuedInvitationReply,
  nextPageCursor,
  peopleReply,
  personId,
  summaryReply,
} from "./access-admin.fixtures";
import { AccessAdminSection } from "./access-admin-section";

const environment = authoringPageEnvironment("/authoring/access");

/** Ответы BFF истории поверх обычных чтений всех четырёх вкладок. */
function withReplies(routes: BillingRoutes) {
  return billingBeforeRender({ ...accessReads, ...routes });
}

const meta = {
  ...environment,
  beforeEach: [environment.beforeEach, withReplies({})],
  title: "Pages/Authoring/Access",
  component: AccessAdminSection,
  args: { offers: accessOffers },
  parameters: {
    ...environment.parameters,
    docs: {
      description: {
        component:
          "Раздел «Доступ» в production-составе: вкладки «Тарифы», «Приглашения», «Люди и доступ» и " +
          "«Сводка» над одним каталогом владельца. Панели читают и пишут через подменённый BFF billing.",
      },
    },
  },
} satisfies Meta<typeof AccessAdminSection>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Видимая панель: скрытые вкладки остаются смонтированными, но в дерево доступности не входят. */
function currentPanel(canvasElement: HTMLElement) {
  return within(routeContent(canvasElement).getByRole("tabpanel"));
}

async function openTab(canvasElement: HTMLElement, name: string) {
  await userEvent.click(routeContent(canvasElement).getByRole("tab", { name }));
  await expect(
    routeContent(canvasElement).getByRole("tab", { name, selected: true }),
  ).toBeVisible();
  return currentPanel(canvasElement);
}

function lastRequest(route: string): unknown {
  const call = billingRequests.mock.calls.findLast(([name]) => name === route);
  return call?.[1];
}

/** Вкладки идут в порядке production; первой открыты «Тарифы». */
export const Tariffs: Story = {
  beforeEach: withReplies({
    "offers/save": billingOk({
      outcome: "catalog",
      value: {
        id: materialsOffer.offer.id,
        revision: materialsOffer.offer.revision + 1,
        archived: false,
      },
    }),
    "offers/unpublish": billingOk({
      outcome: "catalog",
      value: {
        id: supportOffer.offer.id,
        revision: supportOffer.offer.revision + 1,
        archived: false,
        published: false,
      },
    }),
  }),
  globals: { viewport: { isRotated: false, value: "desktop1440" } },
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await expect(
      page.getAllByRole("tab").map((tab) => tab.textContent),
    ).toEqual(["Тарифы", "Приглашения", "Люди и доступ", "Сводка"]);
    const panel = await openTab(canvasElement, "Тарифы");
    const materials = within(
      panel.getByRole("listitem", { name: materialsOffer.offer.name }),
    );
    await expect(materials.getAllByRole("listitem")).toHaveLength(2);
    await expect(materials.getByText(/подписка на 12/u)).toBeVisible();
    const save = materials.getByRole("button", { name: "Сохранить допуск" });
    await expect(save).toBeDisabled();
    await userEvent.selectOptions(
      materials.getByLabelText("Кому продаётся"),
      "invitation_only",
    );
    await userEvent.click(save);
    await expect(
      await panel.findByText(
        `«${materialsOffer.offer.name}» продаётся только по приглашению.`,
      ),
    ).toBeVisible();
    await expect(lastRequest("offers/save")).toMatchObject({
      expectedRevision: materialsOffer.offer.revision,
      value: { id: materialsOffer.offer.id, eligibility: "invitation_only" },
    });
    const support = within(
      panel.getByRole("listitem", { name: supportOffer.offer.name }),
    );
    await expect(support.getByLabelText("Кому продаётся")).toHaveValue(
      "invitation_only",
    );
    await userEvent.click(
      support.getByRole("button", { name: "Снять с продажи" }),
    );
    await expect(
      await panel.findByText(/снят с продажи\. Выданный доступ сохранён\./u),
    ).toBeVisible();
    const guide = within(
      panel.getByRole("listitem", { name: guideOnlyOffer.offer.name }),
    );
    await expect(guide.getByText("Не продаётся")).toBeVisible();
  },
};

/** Без терминала и адреса для чеков продажу не включить: отказ назван словами владельца. */
export const SaleRefused: Story = {
  beforeEach: withReplies({
    "offers/publish": billingRefused("method_unavailable"),
  }),
  play: async ({ canvasElement }) => {
    const panel = currentPanel(canvasElement);
    const guide = within(
      panel.getByRole("listitem", { name: guideOnlyOffer.offer.name }),
    );
    await userEvent.click(
      guide.getByRole("button", { name: "Включить продажу" }),
    );
    await expect(await panel.findByRole("alert")).toHaveTextContent(
      /Оплата не настроена/u,
    );
    await expect(lastRequest("offers/publish")).toMatchObject({
      id: guideOnlyOffer.offer.id,
    });
  },
};

export const TariffsEmpty: Story = { args: { offers: [] } };

/** Пустой список зовёт выдать первое приглашение; выданная ссылка видна сразу. */
export const InvitationIssued: Story = {
  beforeEach: withReplies({
    "invitations/list": invitationsReply([]),
    "invitations/issue": issuedInvitationReply(
      invitation("e07", {
        mode: "purchase",
        offerId: supportOffer.offer.id,
        note: "Гость эфира",
      }),
    ),
  }),
  play: async ({ canvasElement }) => {
    const panel = await openTab(canvasElement, "Приглашения");
    await expect(await panel.findByText(/Приглашений пока нет/u)).toBeVisible();
    await expect(panel.queryByLabelText("Месяцев")).not.toBeInTheDocument();
    await userEvent.selectOptions(
      panel.getByLabelText("Предложение"),
      supportOffer.offer.id,
    );
    await userEvent.type(panel.getByLabelText("Заметка"), "Гость эфира");
    await userEvent.click(
      panel.getByRole("button", { name: "Создать приглашение" }),
    );
    await expect(
      await panel.findByText(
        "https://t.me/synthetic_inside_bot?start=i_Syn7hetice07",
      ),
    ).toBeVisible();
    await expect(panel.getByText(/Приглашение готово: оплата/u)).toBeVisible();
    await expect(lastRequest("invitations/issue")).toMatchObject({
      offerId: supportOffer.offer.id,
      mode: "purchase",
      note: "Гость эфира",
    });
  },
};

/** Приглашение допускает только к оплате; без имени бота владелец получает параметр запуска. */
export const InvitationWithoutBotName: Story = {
  beforeEach: withReplies({
    "invitations/list": invitationsReply([]),
    "invitations/issue": issuedInvitationReply(
      invitation("e08", { mode: "purchase", link: null }),
    ),
  }),
  play: async ({ canvasElement }) => {
    const panel = await openTab(canvasElement, "Приглашения");
    await userEvent.selectOptions(
      await panel.findByLabelText("Предложение"),
      materialsOffer.offer.id,
    );
    await expect(panel.queryByLabelText("Месяцев")).not.toBeInTheDocument();
    await userEvent.click(
      panel.getByRole("button", { name: "Создать приглашение" }),
    );
    await expect(await panel.findByText("i_Syn7hetice08")).toBeVisible();
    await expect(panel.getByText(/Имя бота не настроено/u)).toBeVisible();
    await expect(lastRequest("invitations/issue")).toMatchObject({
      offerId: materialsOffer.offer.id,
      mode: "purchase",
      note: null,
    });
  },
};

/** Каждое состояние подписано словами владельца; отозвать можно только выданное и открытое. */
export const InvitationStates: Story = {
  beforeEach: withReplies({
    "invitations/list": invitationsReply(everyStateInvitations, nextPageCursor),
    "invitations/revoke": billingRefused("state_conflict"),
  }),
  play: async ({ canvasElement }) => {
    const panel = await openTab(canvasElement, "Приглашения");
    for (const label of [
      "Выдано",
      "Открыто",
      "Оплата открыта",
      "Сгорело",
      "Отозвано",
    ])
      await expect(
        await panel.findByRole("listitem", {
          name: new RegExp(`: ${label}$`, "u"),
        }),
      ).toBeVisible();
    await expect(
      panel.getByText("Гость эфира, оплата со скидкой"),
    ).toBeVisible();
    await expect(
      panel.getAllByRole("button", { name: "Отозвать" }),
    ).toHaveLength(2);
    await expect(
      panel.getByRole("button", { name: "Показать ещё" }),
    ).toBeVisible();
    const claimed = within(
      panel.getByRole("listitem", { name: /: Открыто$/u }),
    );
    await userEvent.click(claimed.getByRole("button", { name: "Отозвать" }));
    await expect(await panel.findByRole("alert")).toHaveTextContent(
      /отозвать его нельзя/u,
    );
    await expect(lastRequest("invitations/revoke")).toMatchObject({
      invitationId: everyStateInvitations[1]?.id,
      expectedRevision: everyStateInvitations[1]?.revision,
    });
    await userEvent.click(panel.getByRole("button", { name: "Сгорело" }));
    await waitFor(() =>
      expect(lastRequest("invitations/list")).toMatchObject({
        state: "expired",
      }),
    );
  },
};

export const InvitationsUnavailable: Story = {
  beforeEach: withReplies({
    "invitations/list": billingRefused("unavailable"),
  }),
  play: async ({ canvasElement }) => {
    const panel = await openTab(canvasElement, "Приглашения");
    await expect(
      await panel.findByText(/Данные оплаты сейчас недоступны/u),
    ).toBeVisible();
  },
};

function person(canvasElement: HTMLElement, id: string) {
  return within(
    currentPanel(canvasElement).getByRole("listitem", {
      name: `Account ${personId(id)}`,
    }),
  );
}

/** Все источники подписаны словами владельца, срок назван последним днём по Москве. */
export const People: Story = {
  beforeEach: withReplies({
    "people/list": (input) =>
      typeof input === "object" && input !== null && "source" in input
        ? peopleReply([])
        : peopleReply(accessPeople, nextPageCursor),
  }),
  play: async ({ canvasElement }) => {
    const panel = await openTab(canvasElement, "Люди и доступ");
    await expect(
      await panel.findAllByRole("listitem", { name: /^Account / }),
    ).toHaveLength(6);
    for (const label of [
      "Оплата подписки",
      "Курс",
      "Решение владельца",
      "Разовая покупка",
      "Tribute",
    ])
      await expect(
        panel.getAllByText(new RegExp(label, "u")).length,
      ).toBeGreaterThan(0);
    await expect(
      person(canvasElement, "c01").getByText(
        /до 1 апр\. 2030 г\. включительно/u,
      ),
    ).toBeVisible();
    await expect(
      person(canvasElement, "c02").getByText("Telegram не привязан"),
    ).toBeVisible();
    await expect(
      panel.getByRole("button", { name: "Показать ещё" }),
    ).toBeVisible();
    await userEvent.selectOptions(panel.getByLabelText("Источник"), "tribute");
    await expect(
      await panel.findByText("Под эти фильтры никто не подходит."),
    ).toBeVisible();
    await expect(lastRequest("people/list")).toMatchObject({
      source: "tribute",
    });
  },
};

/** Карточка отправляет новый срок; доступ изменился в другом окне — отказ назван над списком. */
export const ChangeRefused: Story = {
  beforeEach: withReplies({
    "enrollments/change": billingRefused("revision_conflict"),
  }),
  play: async ({ canvasElement }) => {
    const panel = await openTab(canvasElement, "Люди и доступ");
    await panel.findAllByRole("listitem", { name: /^Account / });
    const paying = person(canvasElement, "c01");
    await userEvent.click(paying.getByText(personId("c01")));
    await expect(
      paying.getByText(/Оплаченную подписку меняют отмена продления/u),
    ).toBeVisible();
    const giftee = person(canvasElement, "c02");
    await userEvent.click(giftee.getByText(personId("c02")));
    const form = within(
      giftee.getByRole("group", {
        name: `${supportOffer.offer.name} · Решение владельца`,
      }),
    );
    await expect(form.queryByLabelText("Доступ до")).not.toBeInTheDocument();
    await userEvent.type(
      form.getByLabelText("Причина"),
      "Продление по просьбе",
    );
    await userEvent.click(form.getByRole("button", { name: "Отозвать" }));
    await expect(await panel.findByRole("alert")).toHaveTextContent(
      /Доступ изменился, пока была открыта карточка/u,
    );
    await expect(lastRequest("enrollments/change")).toMatchObject({
      enrollmentId: personId("d02"),
      action: "revoke",
      reason: "Продление по просьбе",
    });
  },
};

export const PeopleUnavailable: Story = {
  beforeEach: withReplies({ "people/list": billingRefused("unavailable") }),
  play: async ({ canvasElement }) => {
    const panel = await openTab(canvasElement, "Люди и доступ");
    await expect(
      await panel.findByText(/Данные оплаты сейчас недоступны/u),
    ).toBeVisible();
  },
};

/** Четыре блока сводки с цифрами владельца. */
export const Summary: Story = {
  play: async ({ canvasElement }) => {
    const panel = await openTab(canvasElement, "Сводка");
    for (const title of [
      "Активные",
      "Приглашения",
      "Требуют внимания",
      "Выручка и возвраты",
    ])
      await expect(
        await panel.findByRole("heading", { name: title }),
      ).toBeVisible();
    const active = within(
      panel.getByRole("table", { name: "Активные по Offer и курсу" }),
    );
    await expect(
      active.getByRole("row", {
        name: `${supportOffer.offer.name} 128 9 0`,
      }),
    ).toBeVisible();
    const attention = within(
      panel.getByRole("list", { name: "Требуют внимания" }),
    );
    await expect(attention.getByText(/Списание не прошло/u)).toBeVisible();
    await expect(
      attention.getByText(/Доступ до 20 мар\. 2030 г\. включительно/u),
    ).toBeVisible();
    await expect(panel.getByText("март 2030 г.")).toBeVisible();
  },
};

export const SummaryQuiet: Story = {
  beforeEach: withReplies({
    "access-summary": summaryReply({
      ...accessSummary,
      active: [],
      attention: [],
      revenue: [],
    }),
  }),
  play: async ({ canvasElement }) => {
    const panel = await openTab(canvasElement, "Сводка");
    await expect(
      await panel.findByText("Никому не нужно внимание."),
    ).toBeVisible();
    await expect(panel.getByText(/оплат не было/u)).toBeVisible();
  },
};

export const SummaryLoading: Story = {
  beforeEach: withReplies({ "access-summary": billingNeverAnswers }),
  play: async ({ canvasElement }) => {
    await openTab(canvasElement, "Сводка");
  },
};

export const SummaryUnavailable: Story = {
  beforeEach: withReplies({ "access-summary": billingRefused("unavailable") }),
  play: async ({ canvasElement }) => {
    const panel = await openTab(canvasElement, "Сводка");
    await expect(
      await panel.findByText(/Данные оплаты сейчас недоступны/u),
    ).toBeVisible();
  },
};

export const Mobile: Story = {
  globals: { viewport: { isRotated: false, value: "mobile390" } },
  play: async ({ canvasElement }) => {
    await expect(
      canvasElement.ownerDocument.documentElement.scrollWidth,
    ).toBeLessThanOrEqual(
      canvasElement.ownerDocument.documentElement.clientWidth,
    );
  },
};

export const InvitationsMobile: Story = {
  globals: { viewport: { isRotated: false, value: "mobile390" } },
  play: async ({ canvasElement }) => {
    const panel = await openTab(canvasElement, "Приглашения");
    await panel.findAllByRole("listitem", { name: /: Выдано$/u });
  },
};
