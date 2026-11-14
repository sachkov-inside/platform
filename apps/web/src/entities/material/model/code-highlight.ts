/** One coloured run of a code line. `color` is a CSS colour, usually a `--code-*` variable. */
export interface CodeToken {
  readonly text: string;
  readonly color?: string | undefined;
}

/** A highlighted code block: lines of tokens plus the language name the reader sees. */
export interface HighlightedCode {
  readonly label: string;
  readonly lines: readonly (readonly CodeToken[])[];
}

/**
 * Highlighting computed on the server for the code blocks of one body. The key is the block's
 * language and text, so nested blocks and repeated snippets need no block identity.
 */
export type MaterialCodeHighlights = ReadonlyMap<string, HighlightedCode>;

export function codeHighlightKey(block: {
  readonly language?: string | undefined;
  readonly text: string;
}): string {
  return `${block.language ?? ""}\u0000${block.text}`;
}
