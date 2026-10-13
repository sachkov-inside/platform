import type { Meta, StoryObj } from "@storybook/react-vite";
import { publicPageEnvironment } from "@/storybook/story-environment";
import { getQueryClient } from "@/shared/api/query-client";
import {
  respondByPath,
  subscribedMemberRoutes,
} from "@/storybook/account.fixtures";
import { fetchBeforeRender } from "@/storybook/mutation-mock";
import { UnifiedReadingPrototype } from "./unified-reading-prototype";

const environment = publicPageEnvironment(
  "/materials/inside-content-aie-ch1-project-setup",
  {
    account: "authenticated",
  },
);
const meta = {
  ...environment,
  beforeEach: () => {
    getQueryClient().clear();
    environment.beforeEach();
    return fetchBeforeRender(respondByPath(subscribedMemberRoutes))();
  },
  title: "Prototypes/Unified Guide Task Reading",
  component: UnifiedReadingPrototype,
  parameters: { layout: "fullscreen" },
  tags: ["autodocs"],
} satisfies Meta<typeof UnifiedReadingPrototype>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Playground: Story = {};
