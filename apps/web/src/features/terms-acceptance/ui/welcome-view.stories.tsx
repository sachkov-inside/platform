import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";

import { legalDocumentPath, legalEditionPath } from "@/shared/routing/public-page-path";
import { publicPageEnvironment } from "@/workshop/story-environment";

import { WelcomeView } from "./welcome-view";

const environment = publicPageEnvironment("/welcome");

const meta = {
  ...environment,
  title: "Pages/Welcome",
  component: WelcomeView,
  args: {
    returning: false,
    termsHref: legalEditionPath("terms", 1),
    privacyHref: legalDocumentPath("privacy"),
    onAccept: fn(),
  },
  parameters: {
    ...environment.parameters,
    docs: {
      description: {
        component:
          "Экран первого входа (путь A, Workspace #185): условия использования принимаются одной кнопкой со строкой о принятии, без отметок. До нажатия закрыты кабинет, покупки и связка с ботом.",
      },
    },
  },
} satisfies Meta<typeof WelcomeView>;
export default meta;
type Story = StoryObj<typeof meta>;

export const FirstSignIn: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Аккаунт создан")).toBeInTheDocument();
    await expect(
      canvas.getByRole("heading", { level: 1, name: "Добро пожаловать в Inside" }),
    ).toBeInTheDocument();
    await expect(canvas.queryByRole("checkbox")).not.toBeInTheDocument();
    await expect(canvas.getByRole("link", { name: "условия использования" })).toHaveAttribute(
      "href",
      "/legal/terms/v1",
    );
    await expect(
      canvas.getByText(/пользоваться Inside можно с 14 лет/u),
    ).toBeInTheDocument();
    await userEvent.click(canvas.getByRole("button", { name: "Принять условия и продолжить" }));
    await expect(args.onAccept).toHaveBeenCalledTimes(1);
  },
};

export const UpdatedTerms: Story = {
  args: { returning: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Условия обновились")).toBeInTheDocument();
    await expect(canvas.queryByText("Аккаунт создан")).not.toBeInTheDocument();
  },
};

export const Pending: Story = {
  args: { pending: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("button", { name: "Принимаем…" })).toBeDisabled();
  },
};

export const EditionChanged: Story = {
  args: {
    error: "Условия только что обновились. Прочитайте действующую редакцию и нажмите кнопку снова.",
  },
};

export const Unavailable: Story = {
  args: { unavailable: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const card = within(canvas.getByRole("region", { name: "Условия использования" }));
    await expect(card.getByRole("alert")).toHaveTextContent("Условия сейчас не удаётся загрузить");
    await expect(card.queryByRole("button")).not.toBeInTheDocument();
  },
};

export const Mobile: Story = {
  globals: { viewport: { isRotated: false, value: "mobile390" } },
};

export const Desktop: Story = {
  globals: { viewport: { isRotated: false, value: "desktop1440" } },
};
