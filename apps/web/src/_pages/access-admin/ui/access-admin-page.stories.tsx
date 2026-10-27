import type { Meta, StoryObj } from "@storybook/react-vite";
import { authoringPageEnvironment } from "@/storybook/story-environment";
import { AccessAdminSection } from "./access-admin-section";
const meta = {
  ...authoringPageEnvironment("/authoring/access"),
  title: "Pages/Authoring/Access",
  component: AccessAdminSection,
  args: { offers: [] },
} satisfies Meta<typeof AccessAdminSection>;
export default meta;
type Story = StoryObj<typeof meta>;
export const LifetimeProductAccess: Story = {};
