import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, spyOn, userEvent, within } from "storybook/test";
import { getStoryRouter } from "../../../.storybook/mocks/next-navigation";
import { useAccessChangeRefresh } from "./use-access-change-refresh.client";

type Session = "unavailable" | "account A" | "account B" | "guest";

function AccountTransition() {
  const [session, setSession] = useState<Session>("unavailable");
  const accountId =
    session === "guest" || session === "unavailable" ? null : session;
  useAccessChangeRefresh(accountId, session !== "unavailable");
  return (
    <div>
      <output>{session}</output>
      {(["account A", "unavailable", "account B", "guest"] as const).map(
        (next) => (
          <button key={next} onClick={() => setSession(next)}>
            {next}
          </button>
        ),
      )}
    </div>
  );
}

export default {
  title: "Patterns/Navigation/Account transition refresh",
  component: AccountTransition,
} satisfies Meta<typeof AccountTransition>;

export const KnownAccountChanges: StoryObj<typeof AccountTransition> = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const refresh = spyOn(getStoryRouter(), "refresh");
    const select = async (name: Session) => {
      await userEvent.click(canvas.getByRole("button", { name }));
      await expect(canvas.getByRole("status")).toHaveTextContent(name);
    };
    try {
      await select("account A");
      await expect(refresh).toHaveBeenCalledTimes(0);
      await select("unavailable");
      await expect(refresh).toHaveBeenCalledTimes(0);
      await select("account A");
      await expect(refresh).toHaveBeenCalledTimes(0);
      await select("unavailable");
      await select("account B");
      await expect(refresh).toHaveBeenCalledTimes(1);
      await select("guest");
      await expect(refresh).toHaveBeenCalledTimes(2);
      await select("account A");
      await expect(refresh).toHaveBeenCalledTimes(3);
    } finally {
      refresh.mockRestore();
    }
  },
};
