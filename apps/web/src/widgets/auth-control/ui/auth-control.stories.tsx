import type { Meta, StoryObj } from "@storybook/react-vite";

import { Sidebar, SidebarBody } from "@/shared/ui/sidebar";

import {
  type AuthControlState,
  DesktopAuthControl,
  MobileAuthControl,
} from "./auth-control.client";

interface AuthControlFixtureProps {
  readonly presentation: "desktop" | "mobile";
  readonly state: AuthControlState;
}

function AuthControlFixture({ presentation, state }: AuthControlFixtureProps) {
  if (presentation === "mobile") {
    return (
      <div className="w-24 rounded-xl border bg-card p-2">
        <MobileAuthControl state={state} />
      </div>
    );
  }
  return (
    <Sidebar defaultPinned>
      <SidebarBody className="relative h-32">
        <div className="mt-auto border-t border-sidebar-border p-3">
          <DesktopAuthControl state={state} />
        </div>
      </SidebarBody>
    </Sidebar>
  );
}

const meta = {
  args: { presentation: "desktop", state: "guest" },
  component: AuthControlFixture,
  parameters: {
    docs: {
      description: {
        component:
          "Presentation-only Platform identity control. Story fixtures choose coarse state; production mapping stays in the server-owned app adapter.",
      },
    },
  },
  title: "Patterns/Identity/Auth control",
} satisfies Meta<typeof AuthControlFixture>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Guest: Story = {};
export const Authenticated: Story = { args: { state: "authenticated" } };
export const Unavailable: Story = { args: { state: "unavailable" } };
export const MobileGuest: Story = {
  args: { presentation: "mobile", state: "guest" },
};
