import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";

import { Button } from "@/shared/ui/button";

import { CommunityEntryView, pathActionClass } from "./community-entry-view";
import { accountSectionEnvironment } from "@/storybook/story-environment";

const environment = accountSectionEnvironment("/account/purchases");
const botUrl = "https://t.me/inside_storybook_bot";

const meta = {
  ...environment,
  title: "Features/Community/Entry",
  component: CommunityEntryView,
  args: {
    entry: { kind: "join", botUrl },
    // Слот: настоящую кнопку подставляет страница из раздела «Доступ».
    telegramAction: (
      <Button className={pathActionClass} type="button">
        Подключить Telegram
      </Button>
    ),
  },
  parameters: {
    ...environment.parameters,
    docs: {
      description: {
        component:
          "Переход в сообщество Inside рядом с покупкой. Состояние выбирает сервер; личную ссылку в группу бот присылает сам после подключения Telegram или выдаёт по /community.",
      },
    },
  },
} satisfies Meta<typeof CommunityEntryView>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Путь в группу показан тремя шагами; текущий шаг отмечен для вспомогательных технологий. */
async function expectCurrentStep(
  canvasElement: HTMLElement,
  name: string | null,
): Promise<void> {
  const region = within(canvasElement).getByRole("region", {
    name: "Сообщество Inside",
  });
  const steps = within(region).getAllByRole("listitem");
  await expect(steps.map((step) => step.dataset["step"])).toEqual([
    "telegram",
    "bot_link",
    "group",
  ]);
  const current = steps.filter(
    (step) => step.getAttribute("aria-current") === "step",
  );
  await expect(current.map((step) => step.dataset["step"])).toEqual(
    name === null ? [] : [name],
  );
}

export const Join: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const link = canvas.getByRole("link", { name: "Вступить в сообщество" });
    // Бот понимает обычный /start: новых параметров ссылка не несёт.
    await expect(link).toHaveAttribute("href", botUrl);
    await expect(link).toHaveAttribute("target", "_blank");
    await expectCurrentStep(canvasElement, "bot_link");
    // Ссылка, появившаяся после «готовим вход», объявляется той же живой областью.
    await expect(canvas.getByRole("status")).toHaveTextContent(
      "Ссылка в сообщество готова.",
    );
  },
};
export const LinkTelegram: Story = {
  args: { entry: { kind: "link_telegram" } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole("button", { name: "Подключить Telegram" }),
    ).toBeEnabled();
    // Возвращаться на сайт не нужно: ссылку бот пришлёт сам.
    await expect(
      canvas.getByText("После подключения бот сам пришлёт личную ссылку."),
    ).toBeInTheDocument();
    await expectCurrentStep(canvasElement, "telegram");
  },
};
export const Preparing: Story = {
  args: { entry: { kind: "preparing" } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("status")).toHaveTextContent(
      /Готовим вход в сообщество/u,
    );
    await expect(
      within(
        canvas.getByRole("region", { name: "Сообщество Inside" }),
      ).queryByRole("link"),
    ).toBeNull();
    await expectCurrentStep(canvasElement, "bot_link");
  },
};
export const Member: Story = {
  args: { entry: { kind: "member" } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // Участник не зовётся вступать повторно.
    await expect(
      canvas.getByText(/Вы уже в сообществе Inside/u),
    ).toBeInTheDocument();
    await expect(
      within(
        canvas.getByRole("region", { name: "Сообщество Inside" }),
      ).queryByRole("link"),
    ).toBeNull();
    // Все шаги пройдены: текущего шага нет.
    await expectCurrentStep(canvasElement, null);
  },
};
export const Restricted: Story = {
  args: { entry: { kind: "restricted" } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText(/сейчас ограничено/u)).toBeInTheDocument();
    const region = canvas.getByRole("region", { name: "Сообщество Inside" });
    await expect(within(region).queryByRole("link")).toBeNull();
    // Ограничение не продвигает путь: шагов нет.
    await expect(within(region).queryByRole("list")).toBeNull();
  },
};
export const WithoutCommunity: Story = {
  args: { entry: { kind: "none" } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByText("Сообщество Inside")).toBeNull();
  },
};
export const FirstReadPending: Story = {
  args: { entry: null },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // До первого ответа блок не рисует пустую карточку у покупки без сообщества.
    await expect(canvas.queryByText("Сообщество Inside")).toBeNull();
  },
};
export const ReadFailed: Story = {
  args: { entry: null, error: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // Чтение повторяется само: ручной кнопки обновления нет.
    const region = canvas.getByRole("region", { name: "Сообщество Inside" });
    await expect(region).toHaveTextContent(/повторим автоматически/u);
    await expect(within(region).queryByRole("button")).toBeNull();
    await expect(within(region).queryByRole("list")).toBeNull();
  },
};
export const JoinMobile: Story = {
  globals: { viewport: { isRotated: false, value: "mobile390" } },
};
export const JoinDesktop: Story = {
  globals: { viewport: { isRotated: false, value: "desktop1440" } },
};
