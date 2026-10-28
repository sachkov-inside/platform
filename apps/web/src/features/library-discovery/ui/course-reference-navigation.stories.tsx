import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, userEvent, within } from "storybook/test";
import { internalRoute } from "@/shared/routing/internal-route";
import { publicPageEnvironment } from "@/storybook/story-environment";
import { CourseReferenceNavigation } from "./course-reference-navigation";

const references = Array.from({ length: 6 }, (_, index) => ({
  id: `reference-${String(index + 1)}`,
  slug: `reference-${String(index + 1)}`,
  title: `Материал ${String(index + 1)}`,
  href: internalRoute(`/materials/reference-${String(index + 1)}`),
}));

const meta = {
  ...publicPageEnvironment("/materials/reference-1"),
  title: "Features/Library/Course References",
  component: CourseReferenceNavigation,
  args: { references, courseHref: internalRoute("/products/course/programme") },
} satisfies Meta<typeof CourseReferenceNavigation>;
export default meta;
type Story = StoryObj<typeof meta>;

export const SixMaterials: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(
      within(canvasElement).getByRole("navigation", {
        name: "Дополнительные материалы",
      }),
    );
    await expect(canvas.getAllByRole("link")).toHaveLength(3);
    const toggle = canvas.getByRole("button", { name: "Показать ещё" });
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    toggle.focus();
    await userEvent.keyboard("{Enter}");
    await expect(canvas.getAllByRole("link")).toHaveLength(6);
    await expect(
      canvas.getByRole("button", { name: "Скрыть" }),
    ).toHaveAttribute("aria-expanded", "true");
    await userEvent.click(canvas.getByRole("button", { name: "Скрыть" }));
    await expect(canvas.getAllByRole("link")).toHaveLength(3);
  },
};

export const CountsAndChapterChange: Story = {
  render: function Counts() {
    const [count, setCount] = useState(0);
    const [chapter, setChapter] = useState(false);
    const items = references.slice(0, count).map((reference) => ({
      ...reference,
      id: chapter ? `other-${reference.id}` : reference.id,
    }));
    return (
      <>
        {[0, 3, 4, 6].map((value) => (
          <button key={value} onClick={() => setCount(value)}>
            {String(value)}
          </button>
        ))}
        <button onClick={() => setChapter((value) => !value)}>
          Другая глава
        </button>
        <CourseReferenceNavigation
          references={items}
          courseHref={internalRoute("/products/course/programme")}
          activeReferenceId="reference-1"
          anchor={{ kind: "material", slug: "lesson" }}
        />
      </>
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.queryByRole("navigation", { name: "Дополнительные материалы" }),
    ).toBeNull();
    await userEvent.click(canvas.getByRole("button", { name: "3" }));
    let group = within(
      canvas.getByRole("navigation", { name: "Дополнительные материалы" }),
    );
    await expect(group.getAllByRole("link")).toHaveLength(3);
    await expect(group.queryByRole("button")).toBeNull();
    await expect(
      group.getByRole("link", { name: "Материал 1" }),
    ).toHaveAttribute("aria-current", "page");
    await expect(
      group.getByRole("link", { name: "Материал 1" }),
    ).toHaveAttribute(
      "href",
      "/materials/reference-1?from=%2Fproducts%2Fcourse%2Fprogramme&anchor=material%3Alesson",
    );
    await userEvent.click(canvas.getByRole("button", { name: "4" }));
    group = within(
      canvas.getByRole("navigation", { name: "Дополнительные материалы" }),
    );
    await userEvent.click(group.getByRole("button", { name: "Показать ещё" }));
    await expect(group.getAllByRole("link")).toHaveLength(4);
    await userEvent.click(canvas.getByRole("button", { name: "Другая глава" }));
    group = within(
      canvas.getByRole("navigation", { name: "Дополнительные материалы" }),
    );
    await expect(group.getAllByRole("link")).toHaveLength(3);
    await expect(
      group.getByRole("button", { name: "Показать ещё" }),
    ).toHaveAttribute("aria-expanded", "false");
  },
};
