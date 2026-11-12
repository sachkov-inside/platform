import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ComponentProps } from "react";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";
import { ProductTopicsEditor } from "./product-topics-editor.client";
import { authoringPageEnvironment } from "@/storybook/story-environment";
import { fetchBeforeRender } from "@/storybook/mutation-mock";

const productId = "95000000-0000-4000-8000-000000000010";
const design = "95000000-0000-4000-8000-000000000030";
const review = "95000000-0000-4000-8000-000000000031";
const material = (index: number) =>
  `95000000-0000-4000-8000-00000000000${String(index)}`;
const refreshNothing: ComponentProps<
  typeof ProductTopicsEditor
>["onRefresh"] = () => Promise.resolve(null);

/** The JSON body the last save sent. */
function sentBody(): Record<string, unknown> {
  const body = save.mock.lastCall?.[1]?.body;
  if (typeof body !== "string") throw new Error("Missing topics command");
  const parsed: unknown = JSON.parse(body);
  if (typeof parsed !== "object" || parsed === null)
    throw new Error("Unexpected topics command");
  return Object.fromEntries(Object.entries(parsed));
}
const save = fn((_input: RequestInfo | URL, _init?: RequestInit) =>
  Promise.resolve(
    Response.json({ kind: "saved", orderVersion: "b".repeat(64) }),
  ),
);

const meta = {
  ...authoringPageEnvironment(`/authoring/products/${productId}`),
  id: "features-product-order-product-topics",
  title: "Patterns/Authoring/Product topics",
  component: ProductTopicsEditor,
  args: {
    productId,
    orderVersion: "a".repeat(64),
    topics: [
      {
        id: design,
        name: "Дизайн с агентами",
        summary: "Макеты, прототипы и интерфейс.",
        materialIds: [material(1)],
      },
      { id: review, name: "Ревью и замечания", summary: "", materialIds: [] },
    ],
    items: [
      {
        materialId: material(1),
        title: "Дизайн с агентом: от референсов до макета",
        publicationState: "published",
      },
      {
        materialId: material(2),
        title: "Куда и как сохранять замечания к работе агента",
        publicationState: "published",
      },
      {
        materialId: material(3),
        title: "Какие модели я использую сейчас",
        publicationState: "draft",
      },
    ],
    onRefresh: refreshNothing,
  },
  beforeEach: () => {
    save.mockClear();
    return fetchBeforeRender(save)();
  },
} satisfies Meta<typeof ProductTopicsEditor>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Автор ставит материал в тему, переносит тему выше и сохраняет весь список тем одной командой. */
export const AssignAndReorder: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText(/без темы: 2/u)).toBeVisible();
    await userEvent.selectOptions(
      canvas.getByRole("combobox", {
        name: "Тема материала «Куда и как сохранять замечания к работе агента»",
      }),
      review,
    );
    await userEvent.click(
      canvas.getByRole("button", { name: "Поднять тему «Ревью и замечания»" }),
    );
    await userEvent.click(
      canvas.getByRole("button", { name: "Сохранить темы" }),
    );
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    await expect(sentBody()["topics"]).toEqual([
      {
        id: review,
        name: "Ревью и замечания",
        summary: "",
        materialIds: [material(2)],
      },
      {
        id: design,
        name: "Дизайн с агентами",
        summary: "Макеты, прототипы и интерфейс.",
        materialIds: [material(1)],
      },
    ]);
    await expect(await canvas.findByRole("status")).toHaveTextContent(
      "Сохранено",
    );
  },
};

/** Новая тема без названия не сохраняется: кнопка ждёт названия. */
export const NewTopicNeedsName: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      canvas.getByRole("button", { name: "Добавить тему" }),
    );
    await expect(
      canvas.getByText("У каждой темы должно быть название."),
    ).toBeVisible();
    await expect(
      canvas.getByRole("button", { name: "Сохранить темы" }),
    ).toBeDisabled();
    const names = canvas.getAllByRole("textbox", { name: "Название темы" });
    const last = names.at(-1);
    if (last === undefined) throw new Error("Missing new topic");
    await userEvent.type(last, "Модели и окружение");
    await expect(
      canvas.getByRole("button", { name: "Сохранить темы" }),
    ).toBeEnabled();
  },
};

export const NoTopics: Story = { args: { topics: [] } };

export const Mobile: Story = {
  globals: { viewport: { value: "mobile390", isRotated: false } },
};
