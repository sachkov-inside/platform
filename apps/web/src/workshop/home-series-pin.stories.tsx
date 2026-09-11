import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { HomeSeriesPinView } from "@/features/series-order";
import { authoringPageEnvironment } from "./story-environment";

const environment = authoringPageEnvironment("/authoring/playlists/72000000-0000-4000-8000-000000000298");

const seriesId = "72000000-0000-4000-8000-000000000298";
const onChange = fn();
const meta = {
  component: HomeSeriesPinView,
  title: "Features/Series/Home pin",
  args: { seriesId, controls: { pin: { seriesId: null, version: 2 }, pending: false, onChange }, message: "Закрепите это руководство: оно появится первым на главной с изображением автора." },
  ...environment,
  decorators: [
    (Story) => (
      <main
        className="h-full min-h-svh overflow-y-auto bg-background text-foreground md:min-h-0"
        id="authoring-content"
        tabIndex={-1}
      >
        <div className="mx-auto w-full max-w-5xl px-4 pb-24 sm:px-8"><Story /></div>
      </main>
    ),
    ...environment.decorators,
  ],
  tags: ["autodocs"],
} satisfies Meta<typeof HomeSeriesPinView>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Available: Story = { play: async ({ canvasElement }) => {
  await userEvent.click(within(canvasElement).getByRole("button", { name: "Закрепить на главной" }));
  await expect(onChange).toHaveBeenCalledWith(seriesId);
} };
export const Selected: Story = { args: { controls: { pin: { seriesId, version: 3 }, pending: false, onChange }, message: "Руководство закреплено на главной." }, play: async ({ canvasElement }) => {
  await userEvent.click(within(canvasElement).getByRole("button", { name: "Снять закреп с главной" }));
  await expect(onChange).toHaveBeenCalledWith(null);
} };
export const Loading: Story = { args: { controls: { pin: null, pending: false, onChange }, message: "Загружаем закреп…" } };
export const Saving: Story = { args: { controls: { pin: { seriesId: null, version: 2 }, pending: true, onChange } } };
export const Conflict: Story = { args: { hasError: true, onRetry: fn(), message: "Закреп изменился в другой вкладке. Состояние обновлено; закрепите руководство ещё раз." } };
export const Unavailable: Story = { args: { controls: { pin: null, pending: false, onChange }, hasError: true, onRetry: fn(), message: "Закреп временно недоступен. Обновите состояние и повторите действие." } };
export const Mobile: Story = { ...Selected, globals: { viewport: { value: "mobile390", isRotated: false } } };
