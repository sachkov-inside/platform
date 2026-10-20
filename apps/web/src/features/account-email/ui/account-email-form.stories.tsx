import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { AccountEmailForm } from "./account-email-form.client";

const meta = {
  component: AccountEmailForm,
  title: "Features/Account/Sign-in email",
  args: {
    email: null,
    challenge: null,
    onStart: fn(),
    onConfirm: fn(),
    onRetry: fn(),
    onChangeAddress: fn(),
  },
} satisfies Meta<typeof AccountEmailForm>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Missing: Story = {};
export const Verified: Story = { args: { email: "member@example.test" } };
export const CodeSent: Story = {
  args: {
    challenge: {
      email: "member@example.test",
      challengeRef: "synthetic-challenge",
    },
  },
};
export const WrongCode: Story = {
  ...CodeSent,
  args: {
    ...CodeSent.args,
    error: "Код неверный или истёк. Проверьте письмо или запросите новый код.",
  },
};
export const Unavailable: Story = { args: { unavailable: true } };
export const SessionExpired: Story = { args: { sessionExpired: true } };
