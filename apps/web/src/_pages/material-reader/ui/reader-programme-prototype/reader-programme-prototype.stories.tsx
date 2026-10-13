import type { Meta, StoryObj } from "@storybook/react-vite";
import { publicPageEnvironment } from "@/storybook/story-environment";
import { ReaderProgrammePrototype } from "./reader-programme-prototype";

const meta = {
  ...publicPageEnvironment("/materials/inside-content-aie-ch1-agent-basics"),
  title: "Prototypes/Course Reader Programme",
  component: ReaderProgrammePrototype,
  parameters: { layout: "fullscreen" },
  tags: ["autodocs"],
} satisfies Meta<typeof ReaderProgrammePrototype>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};
