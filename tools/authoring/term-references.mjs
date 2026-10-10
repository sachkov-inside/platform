// @ts-check

/**
 * @typedef {{ definition: import("@inside/material-blocks").TermDefinition;
 *   publicationState: "draft" | "published" | "unpublished";
 *   available: boolean }} TermReferenceTarget
 * @typedef {{ kind: "term"; termId: string }} TermReference
 */

/** @param {string} value */
const label = (value) => value.trim().normalize("NFC").toLowerCase();

/**
 * One wiki token at a Markdown inline-parser position. The Markdown parser owns escapes,
 * code fences and inline code; this function never searches or replaces a whole document.
 *
 * @param {string} source
 * @param {number} start
 * @returns {{ target: string; text: string; end: number } | undefined}
 */
export function parseTermWikiReference(source, start) {
  if (!source.startsWith("[[", start)) return undefined;
  const close = source.indexOf("]]", start + 2);
  if (close === -1) throw new Error("Unclosed term wiki reference");
  const contents = source.slice(start + 2, close);
  const parts = contents.split("|");
  const [rawTarget = "", rawText] = parts;
  const target = rawTarget.trim();
  const text = rawText?.trim() ?? target;
  if (
    target.length === 0 ||
    text.length === 0 ||
    parts.length > 2 ||
    /[\r\n[\]]/u.test(contents) ||
    /[#^]/u.test(target)
  )
    throw new Error("Unsupported term wiki reference");
  return { target, text, end: close + 2 };
}

/**
 * Resolve already validated authoring definitions. Availability comes from the caller's
 * authorised target read, never from an authored flag. No definition is copied into a body.
 *
 * @param {readonly TermReferenceTarget[]} terms
 * @param {{ allowUnpublished?: boolean }} [options]
 * @returns {(target: string) => TermReference}
 */
export function prepareTermReferences(terms, options = {}) {
  /** @type {Map<string, TermReferenceTarget[]>} */
  const names = new Map();
  /** @type {Map<string, TermReferenceTarget>} */
  const ids = new Map();
  for (const term of terms) {
    const id = term.definition.id.toLowerCase();
    if (ids.has(id)) throw new Error(`Duplicate term ID: ${id}`);
    ids.set(id, term);
    for (const name of new Set(
      [term.definition.title, ...term.definition.aliases].map(label),
    )) {
      const matches = names.get(name) ?? [];
      matches.push(term);
      names.set(name, matches);
    }
  }
  return (target) => {
    const name = label(target);
    const exact = name.startsWith("term:")
      ? ids.get(name.slice("term:".length))
      : undefined;
    const matches = name.startsWith("term:")
      ? exact === undefined
        ? []
        : [exact]
      : (names.get(name) ?? []);
    if (matches.length > 1) throw new Error(`Ambiguous term: ${target}`);
    const [term] = matches;
    if (term === undefined) throw new Error(`Missing term: ${target}`);
    if (!term.available) throw new Error(`Inaccessible term: ${target}`);
    if (
      term.publicationState !== "published" &&
      options.allowUnpublished !== true
    )
      throw new Error(`Unpublished term: ${target}`);
    return { kind: "term", termId: term.definition.id };
  };
}
