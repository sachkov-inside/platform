import type { Meta, StoryObj } from "@storybook/react-vite";
import { InsideConcept } from "./inside-concept.prototype";
const meta = {
  title: "Prototypes/Inside concept",
  component: InsideConcept,
} satisfies Meta<typeof InsideConcept>;
export default meta;
type Story = StoryObj<typeof meta>;
export const App: Story = {};
export const Product: Story = { args: { initialScreen: "product" } };
export const Materials: Story = { args: { initialScreen: "materials" } };
