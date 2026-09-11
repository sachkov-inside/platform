import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { PostLibrary, type PostLibraryProps } from "./post-library.client";
import { broadcastFixture } from "./broadcasts.fixtures";
const firstContent = broadcastFixture.parts[0]?.content;
if (!firstContent) throw new Error("Missing post fixture");
const post = {
  templateId: "10000000-0000-4000-8000-000000000017",
  revision: 2,
  content: {
    ...firstContent,
    entities: [{ type: "bold" as const, offset: 0, length: 6 }],
    buttons: [
      {
        text: "Открыть разбор",
        url: "https://inside.test/materials/outbox",
        row: 0,
      },
      { text: "Все материалы", url: "https://inside.test/materials", row: 0 },
    ],
  },
};
import { authoringPageEnvironment } from "@/workshop/story-environment";

import { BroadcastsPageFrame } from "./broadcasts-page-frame";

const environment = authoringPageEnvironment("/authoring/communications/broadcasts");

const meta = {
  title: "Pages/Communications/Посты из Telegram",
  component: PostLibrary,
  args: {
    posts: [post],
    loading: false,
    error: null,
    hasNext: false,
    onNext: fn(),
    onRefresh: fn(),
    onChoose: fn(),
    onSave: fn<PostLibraryProps["onSave"]>((value) =>
      Promise.resolve({ ...value, revision: value.revision + 1 }),
    ),
    onSample: fn<PostLibraryProps["onSample"]>(() => Promise.resolve(true)),
  },
  ...environment,
  decorators: [
    (Story) => (
      <BroadcastsPageFrame>
        <Story />
      </BroadcastsPageFrame>
    ),
    ...environment.decorators,
  ],
} satisfies Meta<typeof PostLibrary>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Saved: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      canvas.getByRole("button", { name: /Почему очередь/ }),
    );
    await userEvent.clear(canvas.getByLabelText("Название кнопки 1"));
    await userEvent.type(
      canvas.getByLabelText("Название кнопки 1"),
      "Читать разбор",
    );
    await expect(
      canvas.getByRole("button", { name: "Образец себе" }),
    ).toBeDisabled();
    await userEvent.click(
      canvas.getByRole("button", { name: "Сохранить пост" }),
    );
    await expect(args.onSave.mock.calls[0]?.[0].content.entities).toEqual(
      post.content.entities,
    );
    await expect(args.onSave.mock.calls[0]?.[0].content.buttons[0]).toEqual({
      text: "Читать разбор",
      url: "https://inside.test/materials/outbox",
      row: 0,
    });
    await userEvent.click(canvas.getByRole("button", { name: "Образец себе" }));
    await expect(args.onSample.mock.calls[0]?.[0].revision).toBe(3);
    await userEvent.click(
      canvas.getByRole("button", { name: "Добавить в рассылку" }),
    );
    await expect(args.onChoose).toHaveBeenCalledOnce();
  },
};
export const Mobile: Story = {
  ...Saved,
  globals: { viewport: { value: "mobile390", isRotated: false } },
};
export const Dark: Story = { ...Saved, globals: { theme: "dark" } };
export const Empty: Story = { args: { posts: [] } };
export const Loading: Story = { args: { loading: true, posts: [] } };
export const Unavailable: Story = {
  args: { error: "Бот временно недоступен. Попробуйте обновить посты." },
};
export const Conflict: Story = {
  args: { onSave: fn<PostLibraryProps["onSave"]>(() => Promise.resolve(null)) },
};
