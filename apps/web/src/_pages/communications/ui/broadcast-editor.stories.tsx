import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import {
  BroadcastEditor,
  type BroadcastEditorProps,
} from "./broadcast-editor.client";
import {
  broadcastFixture,
  funnelFixture,
  mediaFixture,
} from "./broadcasts.fixtures";
const meta = {
  title: "Pages/Communications/Рассылка",
  component: BroadcastEditor,
  parameters: {
    docs: {
      description: {
        component:
          "Редактор #317: единая реализация для production и Storybook. Текст и заготовки слева, аудитория и расписание справа. Предпросмотр не отправляет сообщения. Визуальная приёмка владельцем ожидается.",
      },
    },
  },
  args: {
    broadcast: broadcastFixture,
    funnels: [funnelFixture],
    pending: false,
    error: null,
    onSave: fn(),
    onLaunch: fn(),
    onPause: fn(),
    onResume: fn(),
    onCancel: fn(),
    onRefresh: fn(),
    onTemplate: fn<BroadcastEditorProps["onTemplate"]>(() =>
      Promise.resolve(null),
    ),
  },
  decorators: [
    (Story) => (
      <main className="mx-auto max-w-6xl p-4">
        <Story />
      </main>
    ),
  ],
} satisfies Meta<typeof BroadcastEditor>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Draft: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Предпросмотр" }));
    await expect(
      canvas.getByRole("region", { name: "Предпросмотр сообщения" }),
    ).toBeVisible();
    await expect(args.onLaunch).not.toHaveBeenCalled();
    await userEvent.type(
      canvas.getByLabelText("Текст", { exact: true }),
      " Изменение",
    );
    await expect(
      canvas.getByRole("button", { name: "Запустить сейчас" }),
    ).toBeDisabled();
    await userEvent.click(
      canvas.getByRole("button", { name: "Сохранить черновик" }),
    );
    await expect(args.onSave).toHaveBeenCalledOnce();
  },
};
export const Scheduled: Story = {
  args: {
    broadcast: {
      ...meta.args.broadcast,
      state: "scheduled",
      scheduledAt: "2030-10-10T12:00:00Z",
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText(/ещё не определены/u)).toBeVisible();
    await expect(canvas.getByRole("button", { name: "Пауза" })).toBeEnabled();
  },
};
export const Paused: Story = {
  args: {
    broadcast: {
      ...meta.args.broadcast,
      state: "paused",
      audienceSnapshotId: "10000000-0000-4000-8000-000000000004",
      snapshotSize: 123,
    },
  },
};
export const Completed: Story = {
  args: {
    broadcast: {
      ...meta.args.broadcast,
      state: "completed",
      audienceSnapshotId: "10000000-0000-4000-8000-000000000004",
      snapshotSize: 123,
    },
  },
};
export const Loading: Story = { args: { pending: true } };
export const Conflict: Story = { args: { error: "revision_conflict" } };
export const Unavailable: Story = { args: { error: "provider_unavailable" } };
export const Denied: Story = { args: { error: "forbidden" } };

export const CorrectInvalidDraft: Story = {
  args: {
    broadcast: { ...meta.args.broadcast, revision: 0 },
    error: "invalid_input",
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const text = canvas.getByLabelText("Текст", { exact: true });
    await expect(text).toBeEnabled();
    await userEvent.type(text, " Исправлено");
    await userEvent.click(
      canvas.getByRole("button", { name: "Сохранить черновик" }),
    );
    await expect(args.onSave).toHaveBeenCalledOnce();
  },
};

export const EditPausedBeforeLaunch: Story = {
  args: {
    broadcast: {
      ...meta.args.broadcast,
      state: "paused",
      scheduledAt: "2030-10-10T12:00:00Z",
    },
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole("button", { name: "Возобновить" }),
    ).toBeEnabled();
    await userEvent.type(
      canvas.getByRole("textbox", { name: "Текст" }),
      " Правка",
    );
    await expect(
      canvas.getByRole("button", { name: "Возобновить" }),
    ).toBeDisabled();
    await userEvent.click(
      canvas.getByRole("button", { name: "Сохранить черновик" }),
    );
    await expect(args.onSave).toHaveBeenCalledOnce();
    await expect(args.onResume).not.toHaveBeenCalled();
  },
};

export const Running: Story = {
  args: {
    broadcast: {
      ...broadcastFixture,
      state: "running",
      audienceSnapshotId: "10000000-0000-4000-8000-000000000004",
      snapshotSize: 920,
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("textbox", { name: "Текст" })).toBeDisabled();
    await expect(canvas.getByRole("button", { name: "Пауза" })).toBeEnabled();
  },
};
export const Cancelled: Story = {
  args: { broadcast: { ...broadcastFixture, state: "cancelled" } },
};
export const Mobile: Story = {
  globals: { viewport: { value: "mobile390", isRotated: false } },
};
export const Dark: Story = { globals: { theme: "dark" } };
export const Keyboard: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    canvas.getByRole("textbox", { name: "Текст" }).focus();
    await userEvent.tab();
    await expect(
      canvas.getByRole("textbox", { name: "Текст кнопки" }),
    ).toHaveFocus();
    await userEvent.tab();
    await expect(
      canvas.getByRole("textbox", { name: "Адрес кнопки" }),
    ).toHaveFocus();
  },
};
export const TemplateAndPreview: Story = {
  args: {
    onTemplate: fn<BroadcastEditorProps["onTemplate"]>(() =>
      Promise.resolve(mediaFixture),
    ),
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.type(
      canvas.getByLabelText("ID или ссылка заготовки"),
      "https://t.me/example/42",
    );
    await userEvent.click(
      canvas.getByRole("button", { name: "Добавить заготовку" }),
    );
    await expect(args.onTemplate).toHaveBeenCalledWith(
      "https://t.me/example/42",
    );
    await expect(
      await canvas.findByRole("heading", { name: "Часть 2 · Кружок" }),
    ).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Предпросмотр" }));
    await expect(
      canvas.getByRole("region", { name: "Предпросмотр сообщения" }),
    ).toHaveTextContent("Кружок");
    await expect(args.onLaunch).not.toHaveBeenCalled();
  },
};
