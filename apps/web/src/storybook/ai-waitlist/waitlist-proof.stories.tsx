import type { Meta, StoryObj } from "@storybook/react-vite";
import { publicPageEnvironment } from "@/storybook/story-environment";
import { WaitlistProof } from "./waitlist-proof";

const environment = publicPageEnvironment("/products/ai-engineering");
const meta = {
  ...environment,
  title: "Proofs/1568 AI Engineering/Waitlist",
  component: WaitlistProof,
  args: { initialState: "guest" },
  parameters: {
    ...environment.parameters,
    docs: {
      description: {
        component:
          "Макет #1568 на текущей странице курса. Состояния и запись только в памяти. Не выполняет настоящий вход и не отправляет запросы. Направление и текст приняты; композиция ждёт отдельной приёмки.",
      },
    },
  },
} satisfies Meta<typeof WaitlistProof>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Guest: Story = {};
export const GuestMobile: Story = {
  globals: { viewport: { value: "mobile390", isRotated: false } },
};
export const TelegramLinked: Story = { args: { initialState: "linked" } };
export const AccountWithoutTelegram: Story = {
  args: { initialState: "account-without-telegram" },
  parameters: { account: "authenticated" },
};
export const TelegramLinking: Story = { args: { initialState: "linking" } };
export const Saving: Story = {
  args: { initialState: "saving", freezeSaving: true },
};
export const Success: Story = { args: { initialState: "success" } };
export const SuccessMobile: Story = {
  ...Success,
  globals: { viewport: { value: "mobile390", isRotated: false } },
};
export const Error: Story = { args: { initialState: "error" } };
export const Enrolled: Story = {
  args: { initialState: "enrolled" },
  parameters: { account: "authenticated" },
};
