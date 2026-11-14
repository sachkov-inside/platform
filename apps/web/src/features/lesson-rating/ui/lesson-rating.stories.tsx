import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";

import { expectPhoneLayout } from "@/storybook/phone-layout";

import { LessonRating } from "./lesson-rating.client";

const meta = {
  id: "features-lesson-rating",
  title: "Components/Material/Lesson rating",
  component: LessonRating,
  args: {
    state: { kind: "ready", rating: null, saving: false, failed: false },
    onRate: fn(),
  },
  decorators: [
    (Story) => (
      <div className="mx-auto max-w-[43rem] p-3">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof LessonRating>;
export default meta;
type Story = StoryObj<typeof meta>;

/** No rating yet: both choices are open. */
export const NotRated: Story = {
  play: async ({ args, canvasElement }) => {
    const rating = within(canvasElement);
    await expect(
      rating.getByRole("group", { name: "Как вам урок?" }),
    ).toBeVisible();
    const like = rating.getByRole("button", { name: "Понравился" });
    await expect(like).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(like);
    await expect(args.onRate).toHaveBeenCalledWith("like");
  },
};

/** The chosen rating is pressed; pressing it again removes it, the other one replaces it. */
export const Liked: Story = {
  args: {
    state: { kind: "ready", rating: "like", saving: false, failed: false },
  },
  play: async ({ args, canvasElement }) => {
    const rating = within(canvasElement);
    const like = rating.getByRole("button", { name: "Понравился" });
    await expect(like).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(like);
    await expect(args.onRate).toHaveBeenLastCalledWith(null);
    await userEvent.click(
      rating.getByRole("button", { name: "Не понравился" }),
    );
    await expect(args.onRate).toHaveBeenLastCalledWith("dislike");
  },
};

export const Failed: Story = {
  args: {
    state: { kind: "ready", rating: null, saving: false, failed: true },
  },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole("status")).toHaveTextContent(
      "Не удалось сохранить оценку. Попробуйте ещё раз.",
    );
  },
};

/** A guest sees a quiet offer to sign in instead of the buttons. */
export const Guest: Story = {
  args: { state: { kind: "guest", loginHref: "/account" } },
  play: async ({ canvasElement }) => {
    const rating = within(canvasElement);
    await expect(rating.getByRole("link", { name: "Войдите" })).toHaveAttribute(
      "href",
      "/account",
    );
    await expect(rating.queryAllByRole("button")).toHaveLength(0);
  },
};

/** A dislike is pressed and visible as the dark round button. */
export const Disliked: Story = {
  args: {
    state: { kind: "ready", rating: "dislike", saving: false, failed: false },
  },
  play: async ({ canvasElement }) => {
    const rating = within(canvasElement);
    await expect(
      rating.getByRole("button", { name: "Не понравился" }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(
      rating.getByRole("button", { name: "Понравился" }),
    ).toHaveAttribute("aria-pressed", "false");
  },
};

export const Phone360: Story = {
  ...Liked,
  globals: { viewport: { value: "mobile360", isRotated: false } },
  play: async ({ canvasElement }) => {
    await expectPhoneLayout(canvasElement, "[data-lesson-rating]");
  },
};
