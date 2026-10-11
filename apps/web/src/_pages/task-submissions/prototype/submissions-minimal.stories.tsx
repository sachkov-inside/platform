import type { Meta, StoryObj } from "@storybook/react-vite";

import { authoringPageEnvironment } from "@/storybook/story-environment";

import { SubmissionsMinimalPrototype } from "./submissions-minimal.client";

const environment = authoringPageEnvironment("/authoring/submissions");
const meta = {
  ...environment,
  title: "Prototypes/Submissions minimal",
  component: SubmissionsMinimalPrototype,
  args: { showVariants: true },
  parameters: {
    ...environment.parameters,
    docs: {
      description: {
        component:
          "Разработка для приёмки владельцем: список каждой сдачи и отдельная страница самопроверки. Данные вымышлены, сохранение только в памяти. Не подключено к production.",
      },
    },
  },
} satisfies Meta<typeof SubmissionsMinimalPrototype>;
export default meta;
type Story = StoryObj<typeof meta>;

export const List: Story = {};
export const Submission: Story = { args: { initialSubmission: "anna-3" } };
export const NeedsChanges: Story = { args: { initialSubmission: "anna-1" } };
export const MissingEvidence: Story = { args: { initialSubmission: "anna-2" } };
export const WithoutTelegram: Story = { args: { initialSubmission: "mark-1" } };
export const Table: Story = { args: { initialVariant: "B" } };
export const ByDate: Story = { args: { initialVariant: "C" } };
export const MobileList: Story = {
  globals: { viewport: { value: "mobile390", isRotated: false } },
};
export const MobileSubmission: Story = {
  args: { initialSubmission: "anna-3" },
  globals: { viewport: { value: "mobile390", isRotated: false } },
};
