import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, mocked, userEvent, within } from "storybook/test";
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
    onSave: fn<BroadcastEditorProps["onSave"]>(),
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
      canvas.getByLabelText("Текст кнопки", { exact: true }),
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
    const text = canvas.getByLabelText("Текст кнопки", { exact: true });
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
      canvas.getByRole("textbox", { name: "Текст кнопки" }),
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
    await userEvent.click(canvas.getByText("Добавить пост по ID или ссылке"));
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

export const TelegramPosts: Story = {
  args: {
    broadcast: { ...broadcastFixture, revision: 0, parts: [] },
    library: {
      posts: [
        {
          templateId: "10000000-0000-4000-8000-000000000017",
          revision: 1,
          content: broadcastFixture.parts[0]?.content ?? {
            type: "text",
            text: "Пост из Telegram",
            entities: [],
            buttons: [],
          },
        },
      ],
      loading: false,
      error: null,
      hasNext: false,
      onNext: fn(),
      onRefresh: fn(),
      onSave: (post) =>
        Promise.resolve({ ...post, revision: post.revision + 1 }),
      onSample: () => Promise.resolve(true),
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      canvas.getByRole("button", { name: /Почему очередь/ }),
    );
  },
};
export const TelegramPostsMobile: Story = {
  ...TelegramPosts,
  globals: { viewport: { value: "mobile390", isRotated: false } },
};

const firstPart = broadcastFixture.parts[0];
if (!firstPart) throw new Error("Broadcast fixture must have a part");

export const ReplaceAfterReorder: Story = {
  args: {
    ...TelegramPosts.args,
    broadcast: { ...broadcastFixture, parts: [firstPart, mediaFixture] },
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Заменить часть 2" }));
    const up = canvas.getAllByRole("button", { name: "Выше" })[1];
    if (!up) throw new Error("Missing second part");
    await userEvent.click(up);
    await userEvent.click(canvas.getByRole("button", { name: /Почему очередь/ }));
    const choose = canvas.getAllByRole("button", { name: "Заменить часть 1" })[0];
    if (!choose) throw new Error("Missing replacement action");
    await userEvent.click(choose);
    await userEvent.click(canvas.getByRole("button", { name: "Сохранить черновик" }));
    await expect(mocked(args.onSave).mock.calls[0]?.[0].payload.parts).toEqual([
      { ...firstPart, partId: mediaFixture.partId }, firstPart,
    ]);
  },
};
export const DeleteReplacementTarget: Story = {
  args: { ...ReplaceAfterReorder.args },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Заменить часть 2" }));
    const remove = canvas.getAllByRole("button", { name: "Удалить часть" })[1];
    if (!remove) throw new Error("Missing second part");
    await userEvent.click(remove);
    await expect(canvas.queryByRole("button", { name: "Отменить замену" })).not.toBeInTheDocument();
    await userEvent.click(canvas.getByRole("button", { name: /Почему очередь/ }));
    await userEvent.click(canvas.getByRole("button", { name: "Добавить в рассылку" }));
    await userEvent.click(canvas.getByRole("button", { name: "Сохранить черновик" }));
    const saved = mocked(args.onSave).mock.calls[0]?.[0].payload.parts;
    await expect(saved).toHaveLength(2);
    await expect(saved?.[0]).toEqual(firstPart);
    await expect(saved?.[1]?.content).toEqual(firstPart.content);
    await expect(saved?.[1]?.partId).not.toBe(firstPart.partId);
  },
};
