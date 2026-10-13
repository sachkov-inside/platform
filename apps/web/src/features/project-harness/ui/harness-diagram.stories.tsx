import type { Meta, StoryObj } from "@storybook/react-vite";
import { cn } from "@/shared/lib/utils";
import { HarnessDiagram } from "./harness-diagram";
import styles from "./harness-diagram.module.css";
const meta = {
  component: HarnessDiagram,
  title: "Features/Project Harness",
  decorators: [
    (Story) => (
      <div className={cn(styles["canvas"], "mx-auto max-w-[43rem]")}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof HarnessDiagram>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Overview: Story = {};
export const Brief: Story = { args: { focus: "brief" } };
export const Skills: Story = { args: { focus: "skills" } };
