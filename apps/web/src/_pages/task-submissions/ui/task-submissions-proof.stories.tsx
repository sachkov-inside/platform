import type { Meta, StoryObj } from "@storybook/react-vite";

import { authoringPageEnvironment } from "@/storybook/story-environment";
import { reviewedSubmissions } from "@/storybook/task-submissions.fixtures";

import { TaskSubmissionsPrototype } from "./task-submissions.prototype";

const environment = authoringPageEnvironment("/authoring/submissions");
const meta = {
  ...environment,
  title: "Prototypes/967/Сдачи",
  component: TaskSubmissionsPrototype,
  args: { submissions: reviewedSubmissions, initialVariant: "A", state: "ready" },
  parameters: {
    ...environment.parameters,
    docs: { description: { component: "Throwaway proof #967. Три структуры в принятой авторской оболочке: очередь, таблица, лента. Переключатель и ?variant=A|B|C. Только синтетические данные; фильтры и отзыв работают в памяти. Production UI остаётся прежним до owner visual GO." } },
  },
} satisfies Meta<typeof TaskSubmissionsPrototype>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Comparison: Story = {};
export const Table: Story = { args: { initialVariant: "B" } };
export const Feed: Story = { args: { initialVariant: "C" } };
export const Loading: Story = { args: { state: "loading" } };
export const Empty: Story = { args: { state: "empty", submissions: { ...reviewedSubmissions, submissions: [] } } };
export const Error: Story = { args: { state: "error" } };
export const Denied: Story = { args: { state: "denied" } };
