import type { RenderedBlock } from "@inside/material-blocks";
import { expect, within } from "storybook/test";

function paragraph(text: string): RenderedBlock {
  return { kind: "paragraph", content: [{ kind: "text", text, marks: [] }] };
}

export const numberedListBlocks: readonly RenderedBlock[] = [
  {
    kind: "ordered_list",
    start: 5,
    items: [
      [
        paragraph("Fifth"),
        {
          kind: "ordered_list",
          start: 8,
          items: [[paragraph("Nested eighth")], [paragraph("Nested ninth")]],
        },
      ],
      [paragraph("Sixth")],
    ],
  },
  {
    kind: "ordered_list",
    items: [[paragraph("First")], [paragraph("Second")]],
  },
  { kind: "bullet_list", items: [[paragraph("Bullet")]] },
];

/** Native ol numbering and visible marker styles on the actual production surfaces. */
export async function expectNumberedLists(canvas: HTMLElement): Promise<void> {
  const lists = canvas.querySelectorAll("ol");
  await expect(lists).toHaveLength(3);
  await expect(Array.from(lists, (list) => list.start)).toEqual([5, 8, 1]);
  await expect(
    Array.from(lists, (list) => getComputedStyle(list).listStyleType),
  ).toEqual(["decimal", "decimal", "decimal"]);
  await expect(lists[0]?.children).toHaveLength(2);
  await expect(lists[1]?.children).toHaveLength(2);
  await expect(lists[0]?.children[1]).toHaveTextContent("Sixth");
  const content = within(canvas);
  const firstItem = content.getByText("Fifth", { exact: true }).closest("li");
  const nested = content
    .getByText("Nested eighth", { exact: true })
    .closest("ol");
  await expect(nested?.parentElement).toBe(firstItem);
  for (const text of [
    "Fifth",
    "Sixth",
    "Nested eighth",
    "Nested ninth",
    "First",
    "Second",
    "Bullet",
  ]) {
    const paragraph = content.getByText(text, { exact: true });
    await expect(paragraph).toBeVisible();
    const item = paragraph.closest("li");
    if (item === null) throw new Error(`Missing list item: ${text}`);
    await expect(getComputedStyle(item).display).toBe("list-item");
  }
  const bullet = content.getByText("Bullet", { exact: true }).closest("ul");
  await expect(bullet).not.toBeNull();
  await expect(bullet).not.toHaveAttribute("start");
}
