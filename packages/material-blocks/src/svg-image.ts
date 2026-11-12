/**
 * An SVG Material image is accepted only when every element, attribute and CSS construct is on an
 * allowlist (#2025). The check parses a strict XML subset: no DOCTYPE, no entity other than the
 * predefined and numeric references, no processing instruction other than the XML declaration.
 * The stored file is the checked tree serialized again, so what a browser parses is exactly what
 * was checked: comments disappear, CDATA and references are re-escaped.
 *
 * Two sides run this check (#2041). The backend runs it on upload and stores what it returns.
 * Reader runs it again, with the figure scope rules of `checkInlineSvgMarkup`, on the bytes it
 * receives before it puts the markup into the page's DOM: a stored file that does not pass is
 * shown through `<img>` instead, where browsers run no script and load nothing external. Opened directly, the checked file has no script, link
 * or external reference, and the delivery's response policy blocks script and fetches as another
 * barrier where it applies.
 */

export const SVG_CONTENT_TYPE = "image/svg+xml";
const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const XLINK_NAMESPACE = "http://www.w3.org/1999/xlink";
const MAX_ELEMENTS = 20_000;
const MAX_DEPTH = 64;
const MAX_ATTRIBUTES = 256;
const MAX_DIMENSION = 16_384;

const ELEMENTS = new Set([
  "circle",
  "clipPath",
  "defs",
  "desc",
  "ellipse",
  "g",
  "line",
  "linearGradient",
  "marker",
  "mask",
  "path",
  "pattern",
  "polygon",
  "polyline",
  "radialGradient",
  "rect",
  "stop",
  "style",
  "svg",
  "symbol",
  "text",
  "title",
  "tspan",
  "use",
]);
/** Elements whose content is text only. */
const TEXT_ONLY_ELEMENTS = new Set(["desc", "style", "title"]);

/** Attributes whose value is plain text and never reaches CSS or a URL resolver. */
const TEXT_ATTRIBUTES = new Set([
  "aria-describedby",
  "aria-hidden",
  "aria-label",
  "aria-labelledby",
  "aria-roledescription",
  "lang",
  "role",
  "xml:lang",
]);
/** Attributes whose value is geometry, paint or a CSS value. */
const VALUE_ATTRIBUTES = new Set([
  "alignment-baseline",
  "baseline-shift",
  "clip-path",
  "clip-rule",
  "clipPathUnits",
  "color",
  "cx",
  "cy",
  "d",
  "display",
  "dominant-baseline",
  "dx",
  "dy",
  "fill",
  "fill-opacity",
  "fill-rule",
  "font-family",
  "font-size",
  "font-style",
  "font-variant",
  "font-weight",
  "fr",
  "fx",
  "fy",
  "gradientTransform",
  "gradientUnits",
  "height",
  "lengthAdjust",
  "letter-spacing",
  "marker-end",
  "marker-mid",
  "marker-start",
  "markerHeight",
  "markerUnits",
  "markerWidth",
  "mask",
  "maskContentUnits",
  "maskUnits",
  "offset",
  "opacity",
  "orient",
  "overflow",
  "paint-order",
  "pathLength",
  "patternContentUnits",
  "patternTransform",
  "patternUnits",
  "points",
  "preserveAspectRatio",
  "r",
  "refX",
  "refY",
  "rotate",
  "rx",
  "ry",
  "shape-rendering",
  "spreadMethod",
  "stop-color",
  "stop-opacity",
  "stroke",
  "stroke-dasharray",
  "stroke-dashoffset",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-miterlimit",
  "stroke-opacity",
  "stroke-width",
  "style",
  "text-anchor",
  "text-decoration",
  "text-rendering",
  "textLength",
  "transform",
  "transform-origin",
  "vector-effect",
  "version",
  "viewBox",
  "visibility",
  "width",
  "word-spacing",
  "writing-mode",
  "x",
  "x1",
  "x2",
  "xml:space",
  "y",
  "y1",
  "y2",
]);
const CSS_AT_RULES = new Set([
  "-webkit-keyframes",
  "keyframes",
  "media",
  "supports",
]);
const CSS_FUNCTIONS = new Set([
  "blur",
  "brightness",
  "calc",
  "clamp",
  "color-mix",
  "contrast",
  "cubic-bezier",
  "drop-shadow",
  "grayscale",
  "hsl",
  "hsla",
  "is",
  "matrix",
  "matrix3d",
  "max",
  "min",
  "not",
  "nth-child",
  "nth-last-child",
  "nth-last-of-type",
  "nth-of-type",
  "opacity",
  "perspective",
  "rgb",
  "rgba",
  "rotate",
  "rotate3d",
  "rotatex",
  "rotatey",
  "rotatez",
  "saturate",
  "scale",
  "scale3d",
  "scalex",
  "scaley",
  "skew",
  "skewx",
  "skewy",
  "steps",
  "translate",
  "translate3d",
  "translatex",
  "translatey",
  "url",
  "var",
  "where",
]);

const NAME = /[A-Za-z_][\w.:-]*/uy;
const ATTRIBUTE = /\s+([A-Za-z_][\w.:-]*)\s*=\s*(?:"([^"<]*)"|'([^'<]*)')/uy;
const TAG_END = /\s*(\/?)>/uy;
const CLOSE_END = /\s*>/uy;
const FRAGMENT_REFERENCE = /^#[A-Za-z_][\w.:-]*$/u;
const IDENTIFIER = /^[A-Za-z_][\w.:-]*$/u;
const CLASS_LIST = /^[\w\s-]*$/u;
const XML_DECLARATION =
  /^<\?xml\s+version\s*=\s*(["'])1\.[0-9]\1(?:\s+encoding\s*=\s*(["'])utf-8\2)?(?:\s+standalone\s*=\s*(["'])(?:yes|no)\3)?\s*\?>/iu;
/** Characters XML 1.0 allows in a document. */
const NOT_XML_CHARACTER =
  /[^\t\n\r\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/u;
const LENGTH = /^\s*(\d+(?:\.\d+)?)\s*(?:px)?\s*$/u;
const NUMBER_LIST = /[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/giu;

export type SvgMarkupCheck =
  | Readonly<{
      ok: true;
      value: Readonly<{ height: number; markup: string; width: number }>;
    }>
  | Readonly<{
      ok: false;
      error: Readonly<{ code: "image_decode_failed" | "unsafe_svg" }>;
    }>;

interface SvgElement {
  readonly attributes: readonly (readonly [string, string])[];
  readonly children: SvgNode[];
  readonly name: string;
}
type SvgNode = SvgElement | string;

class Refusal extends Error {
  readonly code: "image_decode_failed" | "unsafe_svg";
  constructor(code: "image_decode_failed" | "unsafe_svg") {
    super(code);
    this.code = code;
  }
}

/**
 * Checks SVG markup and returns the checked tree serialized again with its layout size. The caller
 * decodes bytes: a file that is not UTF-8 is not an SVG image.
 */
export function checkSvgMarkup(source: string): SvgMarkupCheck {
  return checkMarkup(source, false);
}

/**
 * The stricter check before Reader puts an SVG into the page as markup (#2041). The markup shares
 * the page's DOM and stylesheets, so on top of `checkSvgMarkup` it must keep to its own figure:
 *
 * - the root has an `id` of the form `fig-<name>`, and every other `id` and every `#id` reference
 *   starts with that root id;
 * - every selector of its stylesheets starts with an id selector of the figure, and the root id
 *   is not followed by a sibling combinator, so a rule reaches no element outside the figure;
 * - a style rule nests no other rule;
 * - a keyframes name starts with `a-` (the shared figure names) or with the root id, so no figure
 *   replaces an animation of the page.
 *
 * A file that passes only `checkSvgMarkup` is still shown, through `<img>`.
 */
export function checkInlineSvgMarkup(source: string): SvgMarkupCheck {
  return checkMarkup(source, true);
}

function checkMarkup(source: string, inline: boolean): SvgMarkupCheck {
  try {
    const text = source.replace(/^\uFEFF/u, "");
    if (NOT_XML_CHARACTER.test(text)) throw new Refusal("image_decode_failed");
    const root = parseDocument(text);
    const size = layoutSize(root);
    if (inline) checkFigureScope(root);
    return { ok: true, value: { markup: serialize(root), ...size } };
  } catch (error) {
    if (error instanceof Refusal)
      return { error: { code: error.code }, ok: false };
    throw error;
  }
}

const FIGURE_ID = /^fig-[A-Za-z0-9_-]+$/u;
const FIGURE_KEYFRAMES = /^a-[A-Za-z0-9_-]+$/u;

function checkFigureScope(root: SvgElement) {
  const rootId = attributeValue(root.attributes, "id");
  if (rootId === undefined || !FIGURE_ID.test(rootId))
    throw new Refusal("unsafe_svg");
  const owned = (id: string) => id === rootId || id.startsWith(`${rootId}-`);
  const visit = (element: SvgElement) => {
    for (const [attribute, value] of element.attributes) {
      if (attribute === "id" && !owned(value)) throw new Refusal("unsafe_svg");
      if (
        (attribute === "href" || attribute === "xlink:href") &&
        !owned(value.trim().slice(1))
      )
        throw new Refusal("unsafe_svg");
      if (attribute === "aria-labelledby" || attribute === "aria-describedby")
        for (const id of value.trim().split(/\s+/u))
          if (id.length > 0 && !owned(id)) throw new Refusal("unsafe_svg");
      for (const reference of value.matchAll(/url\(\s*["']?#([^"')\s]+)/giu))
        if (!owned(reference[1] ?? "")) throw new Refusal("unsafe_svg");
    }
    for (const child of element.children)
      if (typeof child !== "string") visit(child);
  };
  visit(root);
  for (const style of descendants(root, "style")) {
    const css = readableCss(
      style.children
        .filter((child): child is string => typeof child === "string")
        .join(""),
    );
    for (const reference of css.matchAll(/url\(\s*["']?#([^"')\s]+)/giu))
      if (!owned(reference[1] ?? "")) throw new Refusal("unsafe_svg");
    checkBrackets(css);
    checkFigureRules(css, 0, false, owned);
  }
}

/**
 * Reads the rules from `position` to the end of the text or to the `}` that closes the current
 * group, and returns the position after it. `@media` and `@supports` hold rules; a `@keyframes`
 * block holds keyframe selectors, which reach no element.
 */
function checkFigureRules(
  css: string,
  position: number,
  nested: boolean,
  owned: (id: string) => boolean,
): number {
  let index = position;
  for (;;) {
    while (index < css.length && /[\s;]/u.test(css[index] ?? "")) index += 1;
    if (index >= css.length) {
      if (nested) throw new Refusal("unsafe_svg");
      return index;
    }
    if (css[index] === "}") {
      if (!nested) throw new Refusal("unsafe_svg");
      return index + 1;
    }
    const open = preludeEnd(css, index);
    const prelude = css.slice(index, open).trim();
    index = open + 1;
    if (prelude.startsWith("@")) {
      const [keyword = "", ...rest] = prelude.slice(1).split(/\s+/u);
      const name = keyword.toLowerCase();
      if (name === "keyframes" || name === "-webkit-keyframes") {
        const keyframes = rest.join(" ").trim();
        if (!FIGURE_KEYFRAMES.test(keyframes) && !owned(keyframes))
          throw new Refusal("unsafe_svg");
        index = blockEnd(css, index);
      } else if (name === "media" || name === "supports") {
        index = checkFigureRules(css, index, true, owned);
      } else throw new Refusal("unsafe_svg");
      continue;
    }
    for (const selector of splitSelectors(prelude))
      checkFigureSelector(selector, owned);
    const close = css.indexOf("}", index);
    if (close === -1 || css.slice(index, close).includes("{"))
      throw new Refusal("unsafe_svg");
    index = close + 1;
  }
}

/**
 * Every `(`, `[` and `{` closes with its own kind, in order. A browser drops a rule broken by a
 * stray bracket and applies the next one; the rule reader below assumes well-nested blocks, so an
 * unmatched bracket could hide a page rule from it (security review of #2041).
 */
function checkBrackets(css: string) {
  const closing: Record<string, string> = { "(": ")", "[": "]", "{": "}" };
  const open: string[] = [];
  for (const character of css) {
    const close = closing[character];
    if (close !== undefined) open.push(close);
    else if (character === ")" || character === "]" || character === "}") {
      if (open.pop() !== character) throw new Refusal("unsafe_svg");
    }
  }
  if (open.length > 0) throw new Refusal("unsafe_svg");
}

/** The position of the `{` that opens the block of the prelude starting at `position`. */
function preludeEnd(css: string, position: number): number {
  let depth = 0;
  for (let index = position; index < css.length; index += 1) {
    const character = css[index];
    if (character === "(" || character === "[") depth += 1;
    else if (character === ")" || character === "]") depth -= 1;
    else if (depth === 0 && character === "{") return index;
    else if (depth === 0 && (character === "}" || character === ";"))
      throw new Refusal("unsafe_svg");
  }
  throw new Refusal("unsafe_svg");
}

/** The position after the `}` that closes the block opened just before `position`. */
function blockEnd(css: string, position: number): number {
  let depth = 1;
  for (let index = position; index < css.length; index += 1) {
    if (css[index] === "{") depth += 1;
    else if (css[index] === "}") {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
  }
  throw new Refusal("unsafe_svg");
}

function splitSelectors(prelude: string): string[] {
  const selectors: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < prelude.length; index += 1) {
    const character = prelude[index];
    if (character === "(" || character === "[") depth += 1;
    else if (character === ")" || character === "]") depth -= 1;
    else if (depth === 0 && character === ",") {
      selectors.push(prelude.slice(start, index));
      start = index + 1;
    }
  }
  selectors.push(prelude.slice(start));
  return selectors.map((selector) => selector.trim());
}

/**
 * A selector starts with an id selector of the figure, and no sibling combinator follows its
 * first compound: `+` and `~` after the root would reach elements outside the figure.
 */
function checkFigureSelector(selector: string, owned: (id: string) => boolean) {
  const id = /^#([A-Za-z0-9_-]+)/u.exec(selector)?.[1];
  if (id === undefined || !owned(id)) throw new Refusal("unsafe_svg");
  // The rest of the first compound: classes, attributes and pseudo-classes of that element.
  let index = 1 + id.length;
  let depth = 0;
  for (; index < selector.length; index += 1) {
    const character = selector[index] ?? "";
    if (character === "(" || character === "[") depth += 1;
    else if (character === ")" || character === "]") depth -= 1;
    else if (depth === 0 && /[\s>+~]/u.test(character)) break;
  }
  const combinator = selector.slice(index).trimStart()[0];
  if (combinator === "+" || combinator === "~") throw new Refusal("unsafe_svg");
}

function parseDocument(source: string): SvgElement {
  let position = 0;
  const declaration = XML_DECLARATION.exec(source);
  if (declaration !== null) position = declaration[0].length;
  const stack: SvgElement[] = [];
  let root: SvgElement | undefined;
  let elements = 0;

  const appendText = (text: string) => {
    const parent = stack.at(-1);
    if (parent === undefined) {
      if (text.trim().length > 0) throw new Refusal("image_decode_failed");
      return;
    }
    if (text.length === 0) return;
    const last = parent.children.at(-1);
    if (typeof last === "string")
      parent.children[parent.children.length - 1] = last + text;
    else parent.children.push(text);
  };

  while (position < source.length) {
    const next = source.indexOf("<", position);
    if (next === -1) {
      appendText(decodeReferences(source.slice(position)));
      break;
    }
    if (next > position)
      appendText(decodeReferences(source.slice(position, next)));
    position = next;
    if (source.startsWith("<!--", position)) {
      const end = source.indexOf("-->", position + 4);
      if (end === -1) throw new Refusal("image_decode_failed");
      position = end + 3;
      continue;
    }
    if (source.startsWith("<![CDATA[", position)) {
      const end = source.indexOf("]]>", position + 9);
      if (end === -1 || stack.length === 0)
        throw new Refusal("image_decode_failed");
      appendText(source.slice(position + 9, end));
      position = end + 3;
      continue;
    }
    if (
      source.startsWith("<!", position) ||
      source.startsWith("<?", position)
    ) {
      throw new Refusal("unsafe_svg");
    }
    if (source.startsWith("</", position)) {
      const name = matchAt(NAME, source, position + 2)?.[0];
      const open = stack.pop();
      if (name === undefined || open?.name !== name)
        throw new Refusal("image_decode_failed");
      position += 2 + name.length;
      const close = matchAt(CLOSE_END, source, position);
      if (close === null) throw new Refusal("image_decode_failed");
      position += close[0].length;
      continue;
    }

    const name = matchAt(NAME, source, position + 1)?.[0];
    if (name === undefined) throw new Refusal("image_decode_failed");
    position += 1 + name.length;
    const attributes: [string, string][] = [];
    const attributeNames = new Set<string>();
    for (;;) {
      const attribute = matchAt(ATTRIBUTE, source, position);
      if (attribute === null) break;
      const attributeName = attribute[1] ?? "";
      if (attributeNames.has(attributeName)) {
        throw new Refusal("image_decode_failed");
      }
      attributeNames.add(attributeName);
      if (attributeNames.size > MAX_ATTRIBUTES) throw new Refusal("unsafe_svg");
      attributes.push([
        attributeName,
        decodeReferences(attribute[2] ?? attribute[3] ?? ""),
      ]);
      position += attribute[0].length;
    }
    const end = matchAt(TAG_END, source, position);
    if (end === null) throw new Refusal("image_decode_failed");
    position += end[0].length;

    const parent = stack.at(-1);
    if (parent === undefined && root !== undefined)
      throw new Refusal("image_decode_failed");
    if (parent === undefined) {
      if (
        name !== "svg" ||
        attributeValue(attributes, "xmlns") !== SVG_NAMESPACE
      ) {
        throw new Refusal("image_decode_failed");
      }
    } else if (TEXT_ONLY_ELEMENTS.has(parent.name)) {
      throw new Refusal("unsafe_svg");
    }
    elements += 1;
    if (elements > MAX_ELEMENTS || stack.length >= MAX_DEPTH)
      throw new Refusal("unsafe_svg");
    checkElement(name, attributes);
    // A prefix is bound only by a declaration on the element or an ancestor; without it the file
    // is not well-formed and shows as a broken image.
    if (
      attributeNames.has("xlink:href") &&
      !attributeNames.has("xmlns:xlink") &&
      !stack.some((ancestor) =>
        ancestor.attributes.some(([attribute]) => attribute === "xmlns:xlink"),
      )
    ) {
      throw new Refusal("image_decode_failed");
    }
    const element: SvgElement = { attributes, children: [], name };
    if (parent === undefined) root = element;
    else parent.children.push(element);
    if (end[1] !== "/") stack.push(element);
  }
  if (root === undefined || stack.length > 0)
    throw new Refusal("image_decode_failed");
  for (const style of descendants(root, "style")) {
    checkCss(
      style.children
        .filter((child): child is string => typeof child === "string")
        .join(""),
      "stylesheet",
    );
  }
  return root;
}

function matchAt(
  pattern: RegExp,
  source: string,
  position: number,
): RegExpExecArray | null {
  pattern.lastIndex = position;
  return pattern.exec(source);
}

function checkElement(
  name: string,
  attributes: readonly (readonly [string, string])[],
) {
  if (!ELEMENTS.has(name)) throw new Refusal("unsafe_svg");
  for (const [attribute, value] of attributes) {
    if (attribute === "xmlns") {
      if (value !== SVG_NAMESPACE) throw new Refusal("unsafe_svg");
    } else if (attribute === "xmlns:xlink") {
      if (value !== XLINK_NAMESPACE) throw new Refusal("unsafe_svg");
    } else if (attribute === "href" || attribute === "xlink:href") {
      if (!FRAGMENT_REFERENCE.test(value.trim()))
        throw new Refusal("unsafe_svg");
    } else if (attribute === "id") {
      if (!IDENTIFIER.test(value)) throw new Refusal("unsafe_svg");
    } else if (attribute === "class") {
      if (!CLASS_LIST.test(value)) throw new Refusal("unsafe_svg");
    } else if (
      name === "style" &&
      (attribute === "type" || attribute === "media")
    ) {
      if (attribute === "type" && value.trim().toLowerCase() !== "text/css") {
        throw new Refusal("unsafe_svg");
      }
      if (attribute === "media") checkCss(value, "inline");
    } else if (TEXT_ATTRIBUTES.has(attribute)) {
      continue;
    } else if (VALUE_ATTRIBUTES.has(attribute)) {
      checkCss(value, "inline");
    } else {
      throw new Refusal("unsafe_svg");
    }
  }
}

/**
 * CSS may reach nothing outside the file. The text is read the way a browser tokenizes it, so a
 * comment opener inside a string hides nothing. A backslash is refused because a CSS escape can
 * spell a forbidden name; an unterminated string or comment is refused. Only the listed at-rules,
 * and none inline, and only the listed functions pass, with `url()` limited to a reference to an
 * id in this file.
 */
function checkCss(text: string, kind: "inline" | "stylesheet") {
  const css = readableCss(text);
  for (const atRule of css.matchAll(/@(-?[A-Za-z_][\w-]*)?/gu)) {
    const ruleName = atRule[1]?.toLowerCase();
    if (
      kind !== "stylesheet" ||
      ruleName === undefined ||
      !CSS_AT_RULES.has(ruleName)
    ) {
      throw new Refusal("unsafe_svg");
    }
  }
  for (const call of css.matchAll(/(-?[A-Za-z_][\w-]*)\(/gu)) {
    const functionName = call[1]?.toLowerCase() ?? "";
    if (!CSS_FUNCTIONS.has(functionName)) throw new Refusal("unsafe_svg");
    if (functionName === "url") {
      const argument = /^url\(\s*(["']?)(#[A-Za-z_][\w.:-]*)\1\s*\)/iu.exec(
        css.slice(call.index),
      );
      if (argument === null) throw new Refusal("unsafe_svg");
    }
  }
}

/**
 * The CSS a browser acts on: comments become a space and strings an empty pair of quotes, except
 * a quoted `#id`, which is kept for `url()`. A backslash is refused because a CSS escape can spell
 * a forbidden name; an unterminated string or comment is refused.
 */
function readableCss(text: string): string {
  if (text.includes("\\")) throw new Refusal("unsafe_svg");
  let css = "";
  let position = 0;
  while (position < text.length) {
    const character = text[position] ?? "";
    if (text.startsWith("/*", position)) {
      const end = text.indexOf("*/", position + 2);
      if (end === -1) throw new Refusal("unsafe_svg");
      css += " ";
      position = end + 2;
    } else if (character === '"' || character === "'") {
      const end = text.indexOf(character, position + 1);
      const content = end === -1 ? "" : text.slice(position + 1, end);
      if (end === -1 || /[\n\r\f]/u.test(content)) {
        throw new Refusal("unsafe_svg");
      }
      css += FRAGMENT_REFERENCE.test(content)
        ? `${character}${content}${character}`
        : '""';
      position = end + 1;
    } else {
      css += character;
      position += 1;
    }
  }
  return css;
}

function decodeReferences(text: string): string {
  return text.replace(/&([^;&\s]*);?/gu, (match, reference: string) => {
    if (!match.endsWith(";")) throw new Refusal("image_decode_failed");
    switch (reference) {
      case "amp":
        return "&";
      case "apos":
        return "'";
      case "gt":
        return ">";
      case "lt":
        return "<";
      case "quot":
        return '"';
    }
    const numeric = /^#(?:x([0-9a-f]+)|([0-9]+))$/iu.exec(reference);
    if (numeric === null) throw new Refusal("unsafe_svg");
    const codePoint =
      numeric[1] === undefined
        ? Number(numeric[2])
        : Number.parseInt(numeric[1], 16);
    if (
      !Number.isSafeInteger(codePoint) ||
      codePoint > 0x10ffff ||
      NOT_XML_CHARACTER.test(String.fromCodePoint(codePoint))
    ) {
      throw new Refusal("image_decode_failed");
    }
    return String.fromCodePoint(codePoint);
  });
}

function layoutSize(root: SvgElement): { height: number; width: number } {
  const viewBox = attributeValue(root.attributes, "viewBox")
    ?.match(NUMBER_LIST)
    ?.map(Number);
  const box =
    viewBox?.length === 4 && (viewBox[2] ?? 0) > 0 && (viewBox[3] ?? 0) > 0
      ? { height: viewBox[3] ?? 0, width: viewBox[2] ?? 0 }
      : undefined;
  const width = pixelLength(attributeValue(root.attributes, "width"));
  const height = pixelLength(attributeValue(root.attributes, "height"));
  let size: { height: number; width: number } | undefined;
  if (width !== undefined && height !== undefined) size = { height, width };
  else if (box !== undefined && width !== undefined)
    size = { height: (width * box.height) / box.width, width };
  else if (box !== undefined && height !== undefined)
    size = { height, width: (height * box.width) / box.height };
  else size = box;
  if (size === undefined) throw new Refusal("image_decode_failed");
  const rounded = {
    height: Math.max(1, Math.round(size.height)),
    width: Math.max(1, Math.round(size.width)),
  };
  if (rounded.width > MAX_DIMENSION || rounded.height > MAX_DIMENSION) {
    throw new Refusal("image_decode_failed");
  }
  return rounded;
}

function pixelLength(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = LENGTH.exec(value);
  const number = parsed === null ? Number.NaN : Number(parsed[1]);
  return number > 0 ? number : undefined;
}

function attributeValue(
  attributes: readonly (readonly [string, string])[],
  name: string,
): string | undefined {
  return attributes.find(([attribute]) => attribute === name)?.[1];
}

function* descendants(
  element: SvgElement,
  name: string,
): Generator<SvgElement> {
  for (const child of element.children) {
    if (typeof child === "string") continue;
    if (child.name === name) yield child;
    yield* descendants(child, name);
  }
}

function serialize(element: SvgElement): string {
  const attributes = element.attributes
    .map(([name, value]) => ` ${name}="${escapeAttribute(value)}"`)
    .join("");
  if (element.children.length === 0) return `<${element.name}${attributes}/>`;
  const children = element.children
    .map((child) =>
      typeof child === "string" ? escapeText(child) : serialize(child),
    )
    .join("");
  return `<${element.name}${attributes}>${children}</${element.name}>`;
}

function escapeText(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeAttribute(text: string): string {
  return escapeText(text)
    .replaceAll('"', "&quot;")
    .replaceAll("\t", "&#9;")
    .replaceAll("\n", "&#10;")
    .replaceAll("\r", "&#13;");
}
