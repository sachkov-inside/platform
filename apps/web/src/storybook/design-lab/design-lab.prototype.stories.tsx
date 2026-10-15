import type { Meta, StoryObj } from "@storybook/react-vite";
import { DesignLab } from "./design-lab.client";
const meta = {
  title: "Prototypes/Design lab",
  component: DesignLab,
} satisfies Meta<typeof DesignLab>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Overview: Story = {};
export const Workspace: Story = { args: { initialScenario: "workspace" } };
export const NextAction: Story = { args: { initialScenario: "next" } };
export const CreationForm: Story = { args: { initialScenario: "form" } };
export const Upload: Story = { args: { initialScenario: "upload" } };
