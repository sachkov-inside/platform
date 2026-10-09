import type { Meta, StoryObj } from "@storybook/react-vite";
import { publicPageEnvironment } from "@/storybook/story-environment";
import { QuizReaderPrototype } from "./quiz-prototype/quiz-reader.prototype.client";

const environment = publicPageEnvironment("/materials/quiz-prototype");
const meta = {
  ...environment,
  title: "Prototypes/Quiz Reader 1277",
  component: QuizReaderPrototype,
  tags: ["autodocs"],
  args: { initialVariant: "A", initialState: "unanswered" },
} satisfies Meta<typeof QuizReaderPrototype>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Playground: Story = {};
export const Correct: Story = { args: { initialState: "correct" } };
export const Incorrect: Story = { args: { initialState: "incorrect" } };
export const DontKnow: Story = { args: { initialState: "dontKnow" } };
export const AllExplanations: Story = { args: { initialState: "all" } };
