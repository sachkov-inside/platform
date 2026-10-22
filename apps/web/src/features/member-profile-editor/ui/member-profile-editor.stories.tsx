import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn, expect, userEvent, within } from "storybook/test";
import { z } from "zod";
import { accountSectionEnvironment } from "@/storybook/story-environment";
import {
  memberProfile,
  subscribedMemberRoutes,
} from "@/storybook/account.fixtures";
import { MemberProfileEditor } from "./member-profile-editor.client";

const meta = {
  component: MemberProfileEditor,
  title: "Features/Account/Display name",
  args: {
    initialProfile: memberProfile,
    suggestedName: "Имя из Telegram",
    onSaved: fn(),
  },
} satisfies Meta<typeof MemberProfileEditor>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Existing: Story = { ...accountSectionEnvironment("/account") };
export const Missing: Story = { ...Existing, args: { initialProfile: null } };
export const SaveName: Story = {
  ...accountSectionEnvironment("/account", {
    fetch: () => async (input, init) => {
      const path = new URL(
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url,
        window.location.origin,
      ).pathname;
      if (path === "/api/account/profile" && init?.method === "PUT") {
        if (typeof init.body !== "string")
          return new Response(null, { status: 400 });
        const body = z
          .object({ displayName: z.string() })
          .parse(JSON.parse(init.body));
        return Response.json({
          kind: "saved",
          profile: {
            ...memberProfile,
            displayName: body.displayName,
            version: 4,
          },
        });
      }
      return (
        subscribedMemberRoutes[path]?.() ?? new Response(null, { status: 404 })
      );
    },
  }),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const name = canvas.getByRole("textbox", { name: "Отображаемое имя" });
    await userEvent.clear(name);
    await userEvent.type(name, "Новое имя");
    await userEvent.click(
      canvas.getByRole("button", { name: "Сохранить имя" }),
    );
    await expect(await canvas.findByText("Имя сохранено.")).toBeVisible();
    await expect(name).toHaveValue("Новое имя");
  },
};
