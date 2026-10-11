import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";

import { materialsOffer, productOnlyOffer } from "@/storybook/billing.fixtures";

import { tariffRows } from "../model/access-operations";
import { TariffsView } from "./tariffs-view.client";

const subscription = {
  ...materialsOffer,
  offer: { ...materialsOffer.offer, published: false },
};
const meta = {
  title: "Features/Billing/Tariffs",
  component: TariffsView,
  args: {
    tariffs: tariffRows([subscription]),
    busy: false,
    message: "",
    failure: null,
    onSaveEligibility: fn(),
    onToggleSale: fn(),
  },
} satisfies Meta<typeof TariffsView>;
export default meta;
type Story = StoryObj<typeof meta>;

export const ConfirmationOpen: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.selectOptions(
      canvas.getByLabelText("Кому продаётся"),
      "invitation_only",
    );
    await userEvent.click(
      canvas.getByRole("button", { name: /^Включить продажу$/u }),
    );
    await expect(
      within(canvas.getByRole("dialog")).getByRole("button", {
        name: "Отмена",
      }),
    ).toHaveFocus();
    await expect(args.onToggleSale).not.toHaveBeenCalled();
  },
};

export const UnsavedInvitationStillWarns: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const trigger = canvas.getByRole("button", {
      name: /^Включить продажу$/u,
    });
    const select = canvas.getByLabelText("Кому продаётся");
    await userEvent.selectOptions(select, "invitation_only");
    await userEvent.click(trigger);
    let dialog = canvas.getByRole("dialog");
    await expect(
      within(dialog).getByRole("button", { name: "Отмена" }),
    ).toHaveFocus();
    await expect(args.onToggleSale).not.toHaveBeenCalled();
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Отмена" }),
    );
    await expect(canvas.queryByRole("dialog")).toBeNull();
    await expect(trigger).toHaveFocus();
    await expect(select).toHaveValue("invitation_only");
    await expect(args.onToggleSale).not.toHaveBeenCalled();
    await userEvent.click(trigger);
    dialog = canvas.getByRole("dialog");
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Включить продажу всем" }),
    );
    await expect(args.onToggleSale).toHaveBeenCalledTimes(1);
    await expect(args.onToggleSale).toHaveBeenCalledWith(args.tariffs[0], true);
  },
};
export const UnsavedEveryoneKeepsSavedInvitation: Story = {
  args: {
    tariffs: tariffRows([
      {
        ...subscription,
        offer: { ...subscription.offer, eligibility: "invitation_only" },
      },
    ]),
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.selectOptions(
      canvas.getByLabelText("Кому продаётся"),
      "everyone",
    );
    await userEvent.click(
      canvas.getByRole("button", { name: /^Включить продажу$/u }),
    );
    await expect(canvas.queryByRole("dialog")).toBeNull();
    await expect(args.onToggleSale).toHaveBeenCalledTimes(1);
    await expect(args.onToggleSale).toHaveBeenCalledWith(args.tariffs[0], true);
  },
};
export const OneTime: Story = {
  args: { tariffs: tariffRows([productOnlyOffer]) },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      canvas.getByRole("button", { name: /^Включить продажу$/u }),
    );
    await expect(canvas.queryByRole("dialog")).toBeNull();
    await expect(args.onToggleSale).toHaveBeenCalledWith(args.tariffs[0], true);
  },
};
export const Unpublish: Story = {
  args: { tariffs: tariffRows([materialsOffer]) },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      canvas.getByRole("button", { name: "Снять с продажи" }),
    );
    await expect(canvas.queryByRole("dialog")).toBeNull();
    await expect(args.onToggleSale).toHaveBeenCalledWith(
      args.tariffs[0],
      false,
    );
  },
};
