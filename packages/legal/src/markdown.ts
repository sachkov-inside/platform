/**
 * Published legal editions are stored as their exact accepted text in a narrow Markdown subset:
 * headings up to the third level, paragraphs, tables and flat numbered or bulleted lists, with
 * links, bold and code spans inside a line. The reader renders these blocks, so an unsupported
 * construct must fail here rather than reach a page as literal punctuation in a document that a
 * buyer accepts.
 */

export type LegalInline =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "strong"; readonly text: string }
  | { readonly kind: "code"; readonly text: string }
  | { readonly kind: "link"; readonly text: string; readonly href: string };

export type LegalBlock =
  | {
      readonly kind: "heading";
      /** Level 3 names a subsection inside a numbered section, such as what a service includes. */
      readonly level: 1 | 2 | 3;
      readonly content: readonly LegalInline[];
    }
  | { readonly kind: "paragraph"; readonly content: readonly LegalInline[] }
  | {
      readonly kind: "list";
      /** A numbered list keeps its order in the text; a bulleted one only groups items. */
      readonly ordered: boolean;
      readonly items: readonly (readonly LegalInline[])[];
    }
  | {
      readonly kind: "table";
      readonly header: readonly (readonly LegalInline[])[];
      readonly rows: readonly (readonly (readonly LegalInline[])[])[];
    };

export class LegalTextError extends Error {
  constructor(message: string) {
    super(`Legal text: ${message}`);
    this.name = "LegalTextError";
  }
}

const inlinePattern =
  /\*\*(?<strong>[^*]+)\*\*|`(?<code>[^`]+)`|\[(?<label>[^\]]+)\]\((?<href>[^)\s]+)\)/gu;
/** A page link stays a site path; an outside reference is an absolute http(s) address. */
const pathPattern = /^\/[\p{L}\p{N}\-._~/]*$/u;
const absolutePattern = /^https?:\/\/\S+$/u;
/** A list item starts at the line start with `- ` or `<number>. ` and carries text. */
const listItemPattern = /^(?:(?<bullet>-)|(?<number>[0-9]+)\.) (?<text>\S.*)$/u;
/** Any other list or quote marker would render as running text with its marker, so it fails. */
const anyListMarkerPattern = /^\s*(?:[-*+]\s|\d+[.)]\s)/u;
const quotePattern = /^\s*>\s/u;

function assertNoOtherBlockMarker(line: string): void {
  if (quotePattern.test(line))
    throw new LegalTextError(`quote blocks are not supported: ${line}`);
  if (listItemPattern.test(line))
    throw new LegalTextError(`list must start after a blank line: ${line}`);
  if (anyListMarkerPattern.test(line))
    throw new LegalTextError(`unsupported list marker: ${line}`);
}

/**
 * Reads one flat list from `start`. Items continue on indented lines; a blank line ends the list.
 * A numbered list counts from 1 without gaps, so the number a reader sees is the one in the text.
 */
function parseList(
  lines: readonly string[],
  start: number,
): { readonly block: LegalBlock; readonly next: number } {
  const items: string[][] = [];
  let ordered: boolean | undefined;
  let index = start;
  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (line.trim().length === 0) break;
    const item = listItemPattern.exec(line);
    if (item?.groups !== undefined) {
      const numbered = item.groups.number !== undefined;
      if (ordered !== undefined && ordered !== numbered)
        throw new LegalTextError(
          `list mixes numbered and bulleted items: ${line}`,
        );
      ordered = numbered;
      if (numbered && Number(item.groups.number) !== items.length + 1)
        throw new LegalTextError(
          `numbered list must count from 1 without gaps: ${line}`,
        );
      items.push([item.groups.text ?? ""]);
    } else if (/^\s/u.test(line)) {
      if (anyListMarkerPattern.test(line) || quotePattern.test(line))
        throw new LegalTextError(`nested lists are not supported: ${line}`);
      items[items.length - 1]?.push(line.trim());
    } else {
      throw new LegalTextError(
        `list item continuation must be indented: ${line}`,
      );
    }
    index += 1;
  }
  return {
    block: {
      kind: "list",
      ordered: ordered ?? false,
      items: items.map((parts) => parseLegalInline(parts.join(" "))),
    },
    next: index,
  };
}

function assertPlain(fragment: string, line: string): void {
  if (fragment.includes("**"))
    throw new LegalTextError(`unbalanced bold marker in line: ${line}`);
  if (fragment.includes("`"))
    throw new LegalTextError(`unbalanced code marker in line: ${line}`);
  if (fragment.includes("]("))
    throw new LegalTextError(`malformed link in line: ${line}`);
}

function assertHref(href: string, line: string): void {
  if (pathPattern.test(href) || absolutePattern.test(href)) return;
  throw new LegalTextError(
    `unsupported link target "${href}" in line: ${line}`,
  );
}

/** Parses one line of running text; the same rules apply inside a table cell. */
export function parseLegalInline(line: string): readonly LegalInline[] {
  const content: LegalInline[] = [];
  let plainFrom = 0;
  for (const match of line.matchAll(inlinePattern)) {
    const groups = match.groups ?? {};
    const plain = line.slice(plainFrom, match.index);
    assertPlain(plain, line);
    if (plain.length > 0) content.push({ kind: "text", text: plain });
    plainFrom = match.index + match[0].length;
    if (groups.strong !== undefined) {
      content.push({ kind: "strong", text: groups.strong });
      continue;
    }
    if (groups.code !== undefined) {
      content.push({ kind: "code", text: groups.code });
      continue;
    }
    const { label, href } = groups;
    if (label === undefined || href === undefined)
      throw new LegalTextError(`unrecognised inline markup in line: ${line}`);
    assertHref(href, line);
    content.push({ kind: "link", text: label, href });
  }
  const tail = line.slice(plainFrom);
  assertPlain(tail, line);
  if (tail.length > 0) content.push({ kind: "text", text: tail });
  if (content.length === 0)
    throw new LegalTextError("empty line reached inline parsing");
  return content;
}

function splitRow(line: string, source: string): readonly string[] {
  if (!line.startsWith("|") || !line.endsWith("|"))
    throw new LegalTextError(`table row must be delimited by "|": ${source}`);
  return line
    .slice(1, -1)
    .split("|")
    .map((cell) => cell.trim());
}

function isDelimiterRow(cells: readonly string[]): boolean {
  return cells.every((cell) => /^-{3,}$/u.test(cell));
}

function parseTable(lines: readonly string[]): LegalBlock {
  const [headerLine, delimiterLine, ...bodyLines] = lines;
  if (headerLine === undefined || delimiterLine === undefined)
    throw new LegalTextError("table needs a header and a delimiter row");
  const header = splitRow(headerLine, headerLine);
  const delimiter = splitRow(delimiterLine, delimiterLine);
  if (!isDelimiterRow(delimiter))
    throw new LegalTextError(`table delimiter row is missing: ${headerLine}`);
  if (delimiter.length !== header.length)
    throw new LegalTextError(`table delimiter width differs: ${headerLine}`);
  const rows = bodyLines.map((line) => {
    const cells = splitRow(line, line);
    if (cells.length !== header.length)
      throw new LegalTextError(`table row width differs: ${line}`);
    return cells.map((cell) => parseLegalInline(cell));
  });
  if (rows.length === 0)
    throw new LegalTextError(`table has no rows: ${headerLine}`);
  return {
    kind: "table",
    header: header.map((cell) => parseLegalInline(cell)),
    rows,
  };
}

/** Splits the stored text into the blocks a page renders, rejecting anything else. */
export function parseLegalText(text: string): readonly LegalBlock[] {
  const blocks: LegalBlock[] = [];
  const lines = text.split("\n");
  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (line.trim().length === 0) {
      index += 1;
      continue;
    }
    if (line.startsWith("#")) {
      const heading = /^(?<hashes>#{1,3}) (?<title>\S.*)$/u.exec(line);
      const hashes = heading?.groups?.hashes;
      const title = heading?.groups?.title;
      if (hashes === undefined || title === undefined)
        throw new LegalTextError(`unsupported heading: ${line}`);
      blocks.push({
        kind: "heading",
        level: hashes.length === 1 ? 1 : hashes.length === 2 ? 2 : 3,
        content: parseLegalInline(title),
      });
      index += 1;
      continue;
    }
    if (line.startsWith("|")) {
      const tableLines: string[] = [];
      while (index < lines.length && (lines[index] ?? "").startsWith("|")) {
        tableLines.push(lines[index] ?? "");
        index += 1;
      }
      blocks.push(parseTable(tableLines));
      continue;
    }
    if (listItemPattern.test(line)) {
      const list = parseList(lines, index);
      blocks.push(list.block);
      index = list.next;
      continue;
    }
    const paragraphLines: string[] = [];
    while (index < lines.length) {
      const current = lines[index] ?? "";
      if (current.trim().length === 0) break;
      if (current.startsWith("#") || current.startsWith("|"))
        throw new LegalTextError(
          `paragraph must end with a blank line before: ${current}`,
        );
      assertNoOtherBlockMarker(current);
      paragraphLines.push(current.trim());
      index += 1;
    }
    blocks.push({
      kind: "paragraph",
      content: parseLegalInline(paragraphLines.join(" ")),
    });
  }
  if (blocks.length === 0) throw new LegalTextError("text has no blocks");
  return blocks;
}

/** Plain reading of a block sequence: used where a text has no markup, such as a page preview. */
export function inlineText(content: readonly LegalInline[]): string {
  return content.map((item) => item.text).join("");
}
