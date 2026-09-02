import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, userEvent, within } from "storybook/test";

import type { PrivateMemberProfile } from "@/entities/member-profile";
import { withMutationFetch } from "@/workshop/mutation-mock";

import type { AccountTelegramMembership } from "@/features/account-access";
import { AccountLoading, AccountUnavailable } from "./account-page";
import { AccountPageClient } from "./account-page.client";

const activeProfile = {
  avatar: null,
  bio: "Развиваю инженерные команды и изучаю agent-first delivery.",
  createdAt: "2026-08-30T10:00:00.000Z",
  displayName: "Кирилл Сачков",
  publicProfileId: "5d34da22-548e-4b02-b6e8-9c918ad536ef",
  status: "active",
  updatedAt: "2026-08-30T10:00:00.000Z",
  version: 3,
} as const satisfies PrivateMemberProfile;

const linkedMember = {
  link: { kind: "linked" },
  membership: { kind: "active" },
} as const satisfies AccountTelegramMembership;
const inactiveMembership = {
  acquisitionUrl: "https://t.me/tribute/app?startapp=inside",
  kind: "inactive",
} as const;
const journeyLinkRef = "62000000-0000-4000-8000-000000000001";

const meta = {
  args: {
    initialProfile: activeProfile,
    initialTelegramMembership: linkedMember,
  },
  component: AccountPageClient,
  parameters: {
    docs: {
      description: {
        component:
          "Production Private Account surface with independent Telegram linking and Membership states, Profile fields, protected avatar crop/upload/remove, and the exact active-member projection.",
      },
    },
    nextjs: { appDirectory: true },
  },
  title: "Pages/Account/Production",
} satisfies Meta<typeof AccountPageClient>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ActiveDesktop: Story = {
  globals: { viewport: { isRotated: false, value: "desktop1440" } },
  name: "Active · desktop",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("heading", { name: "Ваш профиль" })).toBeInTheDocument();
    await expect(canvas.getByRole("heading", { name: "Доступ Inside" })).toBeInTheDocument();
    await expect(canvas.getByText("Telegram связан")).toBeInTheDocument();
    await expect(canvas.getByText("Доступ активен")).toBeInTheDocument();
    await expect(canvas.getByLabelText("Имя")).toHaveValue("Кирилл Сачков");
    await expect(canvas.getAllByText("Кирилл Сачков")).toHaveLength(1);
    await expect(canvas.getByText("Видят участники")).toBeInTheDocument();
    await expect(
      canvas.getByRole("heading", { name: "Профиль участника" }),
    ).toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: "Сохранить" })).toBeDisabled();
    await expect(canvas.queryByText(/жалоб|скачать|удалить профиль/iu)).not.toBeInTheDocument();
    await expect(canvas.queryByText("Граница")).not.toBeInTheDocument();
    await expect(canvas.getByRole("heading", { name: "Аватар" })).toBeInTheDocument();
  },
};

export const Loading: Story = {
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByText("Загружаем Account и состояние доступа…"),
    ).toBeInTheDocument();
  },
  render: () => <AccountLoading />,
};

export const PageUnavailable: Story = {
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByText("Account временно недоступен"),
    ).toBeInTheDocument();
  },
  render: () => <AccountUnavailable reference="ACCOUNT-122" />,
};

export const Unlinked: Story = {
  args: {
    initialTelegramMembership: {
      link: { kind: "unlinked" },
      membership: {
        acquisitionUrl: "https://t.me/tribute/app?startapp=inside",
        kind: "inactive",
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Telegram не связан")).toBeInTheDocument();
    await expect(
      canvas.getByRole("button", { name: "Связать Telegram" }),
    ).toBeInTheDocument();
    await expect(canvas.getByText("Доступ не активен")).toBeInTheDocument();
  },
};

export const Linking: Story = {
  args: {
    initialTelegramMembership: {
      link: {
        expiresAt: "2030-01-01T00:05:00.000Z",
        kind: "linking",
        linkRef: "62000000-0000-4000-8000-000000000001",
      },
      membership: {
        acquisitionUrl: "https://t.me/tribute/app?startapp=inside",
        kind: "inactive",
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Ожидаем подтверждения")).toBeInTheDocument();
    await expect(
      canvas.getByRole("button", { name: "Проверить связь" }),
    ).toBeInTheDocument();
    await expect(canvas.queryByText(/2030|00:05/iu)).not.toBeInTheDocument();
  },
};

export const LinkedNonMember: Story = {
  args: {
    initialTelegramMembership: {
      link: { kind: "linked" },
      membership: {
        acquisitionUrl: "https://t.me/tribute/app?startapp=inside",
        kind: "inactive",
      },
    },
  },
  name: "Linked · Membership inactive or expired",
};

export const LinkConflict: Story = {
  args: {
    initialTelegramMembership: {
      link: {
        kind: "conflict",
        supportUrl: "https://t.me/inside_support",
      },
      membership: {
        acquisitionUrl: "https://t.me/tribute/app?startapp=inside",
        kind: "inactive",
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Обнаружен конфликт")).toBeInTheDocument();
    await expect(
      canvas.getByRole("link", { name: "Написать в поддержку" }),
    ).toHaveAttribute("href", "https://t.me/inside_support");
  },
};

export const Stale: Story = {
  args: {
    initialTelegramMembership: {
      link: { kind: "linked" },
      membership: { kind: "stale" },
    },
  },
};

export const Unavailable: Story = {
  args: {
    initialTelegramMembership: {
      link: {
        kind: "unavailable",
        retry: {
          kind: "confirm",
          linkRef: "62000000-0000-4000-8000-000000000001",
        },
      },
      membership: { kind: "unavailable" },
    },
  },
};

export const RecoveryRequired: Story = {
  args: {
    initialTelegramMembership: {
      link: {
        kind: "recovery-required",
        recovery: {
          kind: "support",
          url: "https://t.me/inside_support",
        },
      },
      membership: {
        acquisitionUrl: "https://t.me/tribute/app?startapp=inside",
        kind: "inactive",
      },
    },
  },
};

export const ExpiredAttempt: Story = {
  args: {
    initialTelegramMembership: {
      link: {
        kind: "retryable",
        reason: "expired",
      },
      membership: {
        acquisitionUrl: "https://t.me/tribute/app?startapp=inside",
        kind: "inactive",
      },
    },
  },
  name: "Expired attempt · safe restart",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Срок попытки истёк")).toBeInTheDocument();
    await expect(
      canvas.getByRole("button", { name: "Начать заново" }),
    ).toBeInTheDocument();
  },
};

let journeyConfirmAttempts = 0;

export const LinkJourney: Story = {
  decorators: [
    withMutationFetch((input) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      const status = url.endsWith("/begin")
        ? "pending"
        : journeyConfirmAttempts++ === 0
          ? "unavailable"
          : "linked";
      return Promise.resolve(
        Response.json({
          kind: "received",
          state: {
            ...(status === "pending"
              ? { deepLink: "https://t.me/inside_test_bot?start=opaque" }
              : {}),
            expiresAt: "2030-01-01T00:05:00.000Z",
            linkRef: journeyLinkRef,
            status,
          },
        }),
      );
    }),
  ],
  name: "Begin → confirm outage → retry → linked",
  play: async ({ canvasElement }) => {
    journeyConfirmAttempts = 0;
    const canvas = within(canvasElement);
    await userEvent.click(
      canvas.getByRole("button", { name: "Связать Telegram" }),
    );
    await expect(
      await canvas.findByRole("link", { name: "Открыть Telegram" }),
    ).toHaveAttribute(
      "href",
      "https://t.me/inside_test_bot?start=opaque",
    );
    await userEvent.click(
      canvas.getByRole("button", { name: "Проверить связь" }),
    );
    await userEvent.click(
      await canvas.findByRole("button", { name: "Повторить проверку" }),
    );
    await expect(await canvas.findByText("Telegram связан")).toBeInTheDocument();
  },
  render: () => <TelegramLinkJourney />,
};

function TelegramLinkJourney() {
  const [presentation, setPresentation] = useState<AccountTelegramMembership>({
    link: { kind: "unlinked" },
    membership: inactiveMembership,
  });
  return (
    <AccountPageClient
      initialProfile={activeProfile}
      initialTelegramMembership={presentation}
      onTelegramMembershipRefresh={() => {
        setPresentation((current) => {
          switch (current.link.kind) {
            case "unlinked":
              return {
                link: {
                  expiresAt: "2030-01-01T00:05:00.000Z",
                  kind: "linking",
                  linkRef: journeyLinkRef,
                },
                membership: current.membership,
              };
            case "linking":
              return {
                link: {
                  kind: "unavailable",
                  retry: { kind: "confirm", linkRef: journeyLinkRef },
                },
                membership: current.membership,
              };
            case "unavailable":
              return {
                link: { kind: "linked" },
                membership: current.membership,
              };
            case "conflict":
            case "linked":
            case "recovery-required":
            case "retryable":
              return current;
          }
        });
        return Promise.resolve();
      }}
    />
  );
}

export const ActiveMobile: Story = {
  globals: { viewport: { isRotated: false, value: "mobile390" } },
  name: "Active · mobile",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const editor = canvas.getByRole("heading", { name: "Редактирование" });
    const preview = canvas.getByRole("heading", { name: "Профиль участника" });
    await expect(editor.compareDocumentPosition(preview) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await expect(canvasElement.ownerDocument.documentElement.scrollWidth).toBeLessThanOrEqual(
      canvasElement.ownerDocument.documentElement.clientWidth,
    );
  },
};

export const Disabled: Story = {
  args: { initialProfile: { ...activeProfile, status: "disabled" } },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByText("Профиль скрыт модерацией"),
    ).toBeInTheDocument();
  },
};

export const Missing: Story = {
  args: { initialProfile: null },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("button", { name: "Создать" })).toBeInTheDocument();
    await expect(
      canvas.getByText(/получит постоянную ссылку для участников/iu),
    ).toBeInTheDocument();
  },
};

export const ProfileConflict: Story = {
  decorators: [
    withMutationFetch(() =>
      Promise.resolve(
        Response.json({ currentVersion: 4, kind: "conflict" }),
      ),
    ),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByLabelText("О себе · необязательно"), " Дополнение.");
    const preview = canvas
      .getByRole("heading", { name: "Профиль участника" })
      .closest("section");
    if (preview === null) throw new Error("Profile preview is missing");
    await expect(
      within(preview).getByText(activeProfile.bio),
    ).toBeInTheDocument();
    await userEvent.click(canvas.getByRole("button", { name: "Сохранить" }));
    await expect(
      canvas.getByText("Профиль уже изменился в другой вкладке."),
    ).toBeInTheDocument();
  },
};
