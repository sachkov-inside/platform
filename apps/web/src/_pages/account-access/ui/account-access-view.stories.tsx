import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";

import { LearningContinuationView } from "@/features/reading-progress";
import type { AcceptedDocumentsPanelProps } from "@/features/accepted-documents";
import { legalEditionPath } from "@/shared/routing/public-page-path";

import { AccountAccessView } from "./account-access-view.client";
import { accountSectionEnvironment } from "@/storybook/story-environment";

const environment = accountSectionEnvironment("/account");

const policies: AcceptedDocumentsPanelProps["policies"] = [
  { label: "политика, редакция 3", href: legalEditionPath("privacy", 3) },
  { label: "cookies, редакция 2", href: legalEditionPath("cookies", 2) },
];

/** Журнал принятия владельца: условия при первом входе, оферта покупки и подписка с автопродлением. */
const acceptedDocuments: AcceptedDocumentsPanelProps = {
  policies,
  state: {
    kind: "ready",
    items: [
      {
        key: "subscription",
        title: "Оферта подписки",
        acceptedAt: "1 октября 2026 г. в 12:10",
        buttonLabel: "Оформить подписку и оплатить 990 ₽",
        edition: "редакция 1",
        href: legalEditionPath("subscription", 1),
        shownTerms:
          "следующее списание 990 ₽ — 1 ноября 2026 г., затем раз в 1 месяц",
      },
      {
        key: "purchase",
        title: "Оферта разовой покупки",
        acceptedAt: "20 сентября 2026 г. в 18:31",
        buttonLabel: "Оплатить 2 500 ₽",
        edition: "редакция 4",
        href: legalEditionPath("purchase", 4),
        shownTerms: null,
      },
      {
        key: "terms",
        title: "Условия использования",
        acceptedAt: "15 сентября 2026 г. в 12:04",
        buttonLabel: "Принять условия и продолжить",
        edition: "редакция 1",
        href: legalEditionPath("terms", 1),
        shownTerms: null,
      },
    ],
  },
};

const meta = {
  ...environment,
  args: {
    displayName: "kirill@example.com",
    acceptedDocuments,
    link: { kind: "linked" },
    onTelegramRefresh: () => Promise.resolve(),
  },
  component: AccountAccessView,
  parameters: {
    ...environment.parameters,
    docs: {
      description: {
        component:
          "Единый личный кабинет: Telegram, документы, выход и компактное продолжение обучения. Покупки и управление подпиской появляются у владельцев.",
      },
    },
  },
  title: "Pages/Account/Cabinet",
} satisfies Meta<typeof AccountAccessView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Linked: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole("heading", { name: "Личный кабинет" }),
    ).toBeInTheDocument();
    await expect(canvas.getByText("Telegram подключён")).toBeInTheDocument();
    await userEvent.click(canvas.getByText("Документы", { exact: true }));
    const accepted = within(
      canvas.getByRole("region", { name: "Принятые документы" }),
    );
    await expect(
      accepted.getByText("Условия использования"),
    ).toBeInTheDocument();
    await expect(
      accepted.getByText(/кнопка «Принять условия и продолжить»/u),
    ).toBeInTheDocument();
    await expect(
      accepted.getByRole("link", { name: "редакция 4" }),
    ).toHaveAttribute("href", "/legal/purchase/v4");
    await expect(
      accepted.getByRole("link", { name: "cookies, редакция 2" }),
    ).toBeInTheDocument();
    await expect(
      canvas.getByRole("button", { name: "Выйти из аккаунта" }),
    ).toBeEnabled();
    // Ни один раздел не показывает задачи другого; список разделов кабинета — не раздел, а принятые
    // документы честно называют показанные у кнопки условия продления.
    await expect(
      canvas.queryByText(/чек|списани/iu, {
        ignore:
          "script, style, [data-account-section-nav] *, [aria-labelledby='accepted-documents'] *",
      }),
    ).not.toBeInTheDocument();
  },
};

export const Unlinked: Story = {
  args: { link: { kind: "unlinked" } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole("button", { name: "Подключить" }),
    ).toBeInTheDocument();
  },
};

export const Loading: Story = { args: { link: null, loading: true } };

/** Состояние аккаунта пришло раньше журнала принятия: журнал показывает свою загрузку. */
export const AcceptedDocumentsLoading: Story = {
  args: { acceptedDocuments: { policies, state: { kind: "loading" } } },
  play: async ({ canvasElement }) => {
    await userEvent.click(
      within(canvasElement).getByText("Документы", { exact: true }),
    );
    const accepted = within(
      within(canvasElement).getByRole("region", { name: "Принятые документы" }),
    );
    await expect(accepted.getByRole("status")).toHaveTextContent(
      "Загружаем принятые документы…",
    );
  },
};

export const AcceptedDocumentsUnavailable: Story = {
  args: { acceptedDocuments: { policies, state: { kind: "unavailable" } } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByText("Документы", { exact: true }));
    await expect(canvas.getByRole("alert")).toHaveTextContent(
      "Список принятых документов сейчас недоступен.",
    );
  },
};

export const SessionExpired: Story = {
  args: { link: null, sessionExpired: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole("button", { name: "Войти" }),
    ).toBeInTheDocument();
    await expect(
      canvas.queryByRole("button", { name: "Выйти из аккаунта" }),
    ).not.toBeInTheDocument();
  },
};

export const Unavailable: Story = {
  args: { link: null, unavailable: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("alert")).toHaveTextContent(
      "Состояние аккаунта сейчас недоступно.",
    );
  },
};

export const Mobile: Story = {
  globals: { viewport: { isRotated: false, value: "mobile390" } },
};
export const Desktop: Story = {
  globals: { viewport: { isRotated: false, value: "desktop1440" } },
};

export const WithLearning: Story = {
  args: {
    continuationSlot: (
      <LearningContinuationView
        continuation={{
          series: {
            collection: { name: "AI Engineering", slug: "ai-engineering" },
            read: 3,
            total: 17,
          },
        }}
      />
    ),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole("link", { name: "Продолжить продукт AI Engineering" }),
    ).toHaveAttribute("href", "/products/ai-engineering/programme");
    await expect(canvas.queryByRole("textbox")).not.toBeInTheDocument();
    const learning = canvas.getByRole("region", {
      name: "Продолжить обучение",
    });
    const telegram = canvas.getByRole("region", {
      name: /^Telegram$/,
    });
    await expect(telegram.getBoundingClientRect().bottom).toBeLessThanOrEqual(
      learning.getBoundingClientRect().top,
    );
    await expect(getComputedStyle(learning).position).toBe("static");
    const documents = canvas.getByRole("button", { name: /Документы/ });
    documents.focus();
    await userEvent.keyboard("{Enter}");
    await expect(documents).toHaveAttribute("aria-expanded", "true");
    await userEvent.keyboard(" ");
    await expect(documents).toHaveAttribute("aria-expanded", "false");
  },
};

export const WithLearningMobile: Story = {
  ...WithLearning,
  globals: { viewport: { isRotated: false, value: "mobile390" } },
};

export const CourseAndVideo: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.hover(
      canvas.getByRole("link", { name: /Как выбрать и настроить агента/u }),
    );
  },
  args: {
    continuationSlot: (
      <LearningContinuationView
        continuation={{
          series: {
            collection: {
              name: "Подготовь проект к разработке: harness, skills и AI-first процесс",
              slug: "ai-engineering",
            },
            read: 3,
            total: 17,
          },
          video: {
            material: {
              slug: "agent-setup",
              title:
                "Как выбрать и настроить агента для работы с большим проектом",
            },
            label: "Продолжить с 12:30",
          },
        }}
      />
    ),
  },
  globals: { viewport: { isRotated: false, value: "mobile390" } },
};
