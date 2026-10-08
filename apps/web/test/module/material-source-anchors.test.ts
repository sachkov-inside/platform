import { describe, expect, it } from "vitest";
import type { RenderedBlock } from "@inside/material-blocks";
import { materialSourceAnchors } from "@/entities/material";

function heading(text: string): RenderedBlock {
  return {
    kind: "heading",
    level: 2,
    content: [{ kind: "text", text, marks: [] }],
  };
}

describe("Content source heading anchors", () => {
  it("matches Content Unicode reader text and allocates suffixes across collisions", () => {
    const blocks = [
      heading("Как спроектировать один этап?"),
      heading("Раздел"),
      heading("Раздел-1"),
      heading("Раздел"),
      heading("Раздел"),
      heading("API: `code` & café_２"),
    ];
    expect([...materialSourceAnchors(blocks).values()]).toEqual([
      "как-спроектировать-один-этап",
      "раздел",
      "раздел-1",
      "раздел-2",
      "раздел-3",
      "api-code--café_２",
    ]);
  });
  it("shares collision allocation across nested reader blocks and ignores code examples", () => {
    const blocks: RenderedBlock[] = [
      heading("Раздел"),
      { kind: "code_block", text: "## Раздел" },
      { kind: "blockquote", content: [heading("Раздел")] },
      { kind: "bullet_list", items: [[heading("Раздел")]] },
    ];
    expect([...materialSourceAnchors(blocks)]).toEqual([
      ["0", "раздел"],
      ["2-0", "раздел-1"],
      ["3-0-0", "раздел-2"],
    ]);
  });
});
