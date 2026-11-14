import { describe, expect, test } from "vitest";

import { highlightMaterialCode } from "@/entities/material.server";
import { codeHighlightKey } from "@/entities/material/model/code-highlight";

describe("highlightMaterialCode", () => {
  test("colours a code block nested in a callout and names its language", async () => {
    const block = {
      kind: "code_block",
      language: "python",
      text: "def answer():\n    return 42",
    } as const;
    const highlights = await highlightMaterialCode([
      { kind: "callout", tone: "tip", content: [block] },
    ]);

    const code = highlights.get(codeHighlightKey(block));
    expect(code?.label).toBe("Python");
    expect(code?.lines).toHaveLength(2);
    expect(
      code?.lines
        .flat()
        .map((token) => token.text)
        .join(""),
    ).toBe("def answer():    return 42");
    expect(code?.lines[0]?.find((token) => token.text === "def")?.color).toBe(
      "var(--code-token-keyword)",
    );
  });

  test("labels an unknown language without colouring and leaves plain text alone", async () => {
    const unknown = { kind: "code_block", language: "brainfuck", text: "+." };
    const plain = { kind: "code_block", language: "text", text: "plain" };
    const bare = { kind: "code_block", text: "no language" };
    const highlights = await highlightMaterialCode([unknown, plain, bare]);

    expect(highlights.get(codeHighlightKey(unknown))).toEqual({
      label: "brainfuck",
      lines: [[{ text: "+." }]],
    });
    expect(highlights.has(codeHighlightKey(plain))).toBe(false);
    expect(highlights.has(codeHighlightKey(bare))).toBe(false);
  });

  test("resolves a language alias to its grammar", async () => {
    const block = { kind: "code_block", language: "sh", text: "echo hi" };
    const highlights = await highlightMaterialCode([block]);

    const code = highlights.get(codeHighlightKey(block));
    expect(code?.label).toBe("Shell");
    expect(code?.lines[0]?.some((token) => token.color !== undefined)).toBe(
      true,
    );
  });
});
