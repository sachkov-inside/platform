import {
  createCssVariablesTheme,
  createHighlighterCore,
  type HighlighterCore,
} from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";

import {
  codeHighlightKey,
  type CodeToken,
  type HighlightedCode,
  type MaterialCodeHighlights,
} from "./code-highlight";

/**
 * Colours come from `--code-*` variables in globals.css, so the palette stays with the design
 * tokens and the highlighted markup carries no theme of its own.
 */
const theme = createCssVariablesTheme({
  name: "material-code",
  variablePrefix: "--code-",
  variableDefaults: {},
  fontStyle: true,
});

/** Languages lessons use. Each grammar also registers its aliases, such as `py` or `sh`. */
const languages = [
  import("shiki/langs/bash.mjs"),
  import("shiki/langs/csharp.mjs"),
  import("shiki/langs/css.mjs"),
  import("shiki/langs/diff.mjs"),
  import("shiki/langs/dockerfile.mjs"),
  import("shiki/langs/html.mjs"),
  import("shiki/langs/javascript.mjs"),
  import("shiki/langs/json.mjs"),
  import("shiki/langs/python.mjs"),
  import("shiki/langs/sql.mjs"),
  import("shiki/langs/tsx.mjs"),
  import("shiki/langs/typescript.mjs"),
  import("shiki/langs/xml.mjs"),
  import("shiki/langs/yaml.mjs"),
];

const plainLanguages = new Set(["text", "txt", "plain", "plaintext"]);

const labels: Readonly<Record<string, string>> = {
  bash: "Bash",
  "c#": "C#",
  cs: "C#",
  csharp: "C#",
  css: "CSS",
  diff: "Diff",
  docker: "Dockerfile",
  dockerfile: "Dockerfile",
  html: "HTML",
  javascript: "JavaScript",
  js: "JavaScript",
  json: "JSON",
  jsonc: "JSON",
  py: "Python",
  python: "Python",
  sh: "Shell",
  shell: "Shell",
  shellscript: "Shell",
  sql: "SQL",
  ts: "TypeScript",
  tsx: "TSX",
  typescript: "TypeScript",
  xml: "XML",
  yaml: "YAML",
  yml: "YAML",
  zsh: "Zsh",
};

let highlighter: Promise<HighlighterCore> | undefined;

function loadHighlighter(): Promise<HighlighterCore> {
  highlighter ??= createHighlighterCore({
    engine: createJavaScriptRegexEngine(),
    langs: languages,
    themes: [theme],
  });
  return highlighter;
}

function codeBlocks(
  value: unknown,
  found: { readonly language: string; readonly text: string }[],
): void {
  if (Array.isArray(value)) {
    for (const item of value) codeBlocks(item, found);
    return;
  }
  if (typeof value !== "object" || value === null) return;
  const record = value as Record<string, unknown>;
  if (
    record["kind"] === "code_block" &&
    typeof record["language"] === "string" &&
    typeof record["text"] === "string"
  ) {
    found.push({ language: record["language"], text: record["text"] });
    return;
  }
  for (const child of Object.values(record)) codeBlocks(child, found);
}

function highlight(
  engine: HighlighterCore,
  language: string,
  text: string,
): HighlightedCode | undefined {
  const name = language.toLowerCase();
  if (plainLanguages.has(name)) return undefined;
  const label = labels[name] ?? language;
  if (!engine.getLoadedLanguages().includes(name))
    return { label, lines: text.split("\n").map((line) => [{ text: line }]) };
  const { tokens } = engine.codeToTokens(text, { lang: name, theme });
  return {
    label,
    lines: tokens.map((line) =>
      line.map((token): CodeToken => ({
        text: token.content,
        ...(token.color === undefined ? {} : { color: token.color }),
      })),
    ),
  };
}

/**
 * Highlights every code block with a language anywhere in a rendered body, including blocks
 * nested in callouts, lists and exercises. Runs on the server so the grammars stay out of the
 * reader's bundle.
 */
export async function highlightMaterialCode(
  blocks: unknown,
): Promise<MaterialCodeHighlights> {
  const found: { readonly language: string; readonly text: string }[] = [];
  codeBlocks(blocks, found);
  if (found.length === 0) return new Map();
  const engine = await loadHighlighter();
  const highlights = new Map<string, HighlightedCode>();
  for (const block of found) {
    const highlighted = highlight(engine, block.language, block.text);
    if (highlighted !== undefined)
      highlights.set(codeHighlightKey(block), highlighted);
  }
  return highlights;
}
