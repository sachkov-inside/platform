// @ts-check
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";

import { readPackageScripts } from "./package-scripts.mjs";

/**
 * Repository references in Markdown: link targets with their fragments, heading anchors,
 * backticked repository paths and `pnpm <script>` commands. Each finding names the document.
 */

const fencePattern = /^ {0,3}(`{3,}|~{3,})/u;

/**
 * Splits Markdown into prose lines and fenced code lines, keeping line numbers.
 *
 * @param {string} markdown
 * @returns {{ prose: string[]; code: string[] }}
 */
function splitFences(markdown) {
  /** @type {string[]} */
  const prose = [];
  /** @type {string[]} */
  const code = [];
  let fence = "";
  for (const line of markdown.split("\n")) {
    const marker = line.match(fencePattern)?.[1];
    if (fence === "") {
      if (marker) {
        fence = marker;
        prose.push("");
        code.push("");
        continue;
      }
      prose.push(line);
      code.push("");
    } else {
      if (
        marker &&
        marker[0] === fence[0] &&
        marker.length >= fence.length &&
        line.trim() === marker
      ) {
        fence = "";
      }
      prose.push("");
      code.push(marker && fence === "" ? "" : line);
    }
  }
  return { prose, code };
}

/**
 * Local Markdown link targets outside fenced code, with an optional fragment. A same-document
 * link has an empty file. External, absolute and protocol links are not repository targets.
 *
 * @param {string} markdown
 * @returns {{ file: string; fragment: string }[]}
 */
export function extractMarkdownLinks(markdown) {
  /** @type {{ file: string; fragment: string }[]} */
  const targets = [];
  const prose = splitFences(markdown).prose.join("\n");
  const links = prose.matchAll(
    /\[[^\]]*\]\((<[^>]+>|[^)\s]+)(?:\s+[^)]*)?\)/gu,
  );

  for (const [, rawTarget = ""] of links) {
    const target = rawTarget.replace(/^<|>$/gu, "");
    if (target.startsWith("/") || /^[a-z][a-z\d+.-]*:/iu.test(target)) {
      continue;
    }

    const hashIndex = target.indexOf("#");
    const withoutFragment =
      hashIndex === -1 ? target : target.slice(0, hashIndex);
    const fragment = hashIndex === -1 ? "" : target.slice(hashIndex + 1);
    const [file = ""] = withoutFragment.split("?", 1);
    targets.push({
      file: decodeURIComponent(file),
      fragment: decodeURIComponent(fragment),
    });
  }

  return targets;
}

/**
 * GitHub heading anchors: rendered text, lower case, punctuation removed, each space a hyphen,
 * and `-1`, `-2` suffixes for repeated headings. Explicit HTML `id`/`name` anchors also count.
 *
 * @param {string} markdown
 * @returns {Set<string>}
 */
export function markdownAnchors(markdown) {
  /** @type {Set<string>} */
  const anchors = new Set();
  /** @type {Map<string, number>} */
  const seen = new Map();
  const { prose } = splitFences(markdown);
  for (const line of prose) {
    for (const [, id = ""] of line.matchAll(
      /<a\s+(?:[^>]*\s)?(?:id|name)="([^"]+)"/giu,
    )) {
      anchors.add(id);
    }
    const heading = line.match(/^ {0,3}#{1,6}\s+(.*?)(?:\s+#+\s*)?$/u)?.[1];
    if (heading === undefined) {
      continue;
    }
    const text = heading
      .replace(/!?\[([^\]]*)\]\([^)]*\)/gu, "$1")
      .replace(/<[^>]+>/gu, "")
      .trim()
      .toLowerCase()
      .replace(/[^\p{L}\p{M}\p{N}\p{Pc}\- ]/gu, "")
      .replace(/ /gu, "-");
    const count = seen.get(text) ?? 0;
    seen.set(text, count + 1);
    anchors.add(count === 0 ? text : `${text}-${count}`);
  }
  return anchors;
}

/** @param {string} line */
function inlineCode(line) {
  return [...line.matchAll(/(?<!`)`([^`\n]+)`(?!`)/gu)].map(([, value = ""]) =>
    value.trim(),
  );
}

/**
 * Backticked values shaped like a relative path with a directory separator, without
 * placeholders, globs, spaces or a URL scheme. An optional `:line` suffix is dropped.
 *
 * @param {string} markdown
 * @returns {string[]}
 */
export function extractCodePaths(markdown) {
  /** @type {string[]} */
  const paths = [];
  for (const line of splitFences(markdown).prose) {
    for (const value of inlineCode(line)) {
      const path = value.replace(/:\d+(?:-\d+)?$/u, "");
      if (
        /^(?:\.{1,2}\/)*[\w-][\w.-]*(?:\/[\w.-]+)*\/[\w.-]*$/u.test(path) &&
        !path.includes("//")
      ) {
        paths.push(path);
      }
    }
  }
  return paths;
}

// Build and runtime outputs are named in prose but never committed.
const generatedSegments = new Set([
  ".next",
  "coverage",
  "dist",
  "node_modules",
  "playwright-report",
  "storybook-static",
  "test-results",
]);
const moduleSuffixes = ["", ".ts", ".tsx", ".mjs", ".js", "/index.ts"];

/**
 * A backticked path is a repository reference when its first segment is an existing directory
 * beside the document or at the repository root; other shapes (image names, artifact names,
 * slash-separated prose) are not checked. A reference resolves with or without a module suffix.
 *
 * @param {string} repositoryRoot
 * @param {string} document absolute document path
 * @param {string} path
 * @returns {boolean | undefined} undefined when the value is not a repository reference
 */
function resolvesCodePath(repositoryRoot, document, path) {
  const leading = path.match(/^(?:\.{1,2}\/)*/u)?.[0] ?? "";
  const rest = path.slice(leading.length).replace(/\/$/u, "");
  const segments = rest.split("/");
  if (segments.some((part) => generatedSegments.has(part))) {
    return undefined;
  }
  const bases = [dirname(document), repositoryRoot]
    .map((base) => resolve(base, leading))
    .filter((base) => {
      const first = resolve(base, segments[0] ?? "");
      return (
        !relative(repositoryRoot, first).startsWith("..") &&
        existsSync(first) &&
        statSync(first).isDirectory()
      );
    });
  if (bases.length === 0) {
    return undefined;
  }
  return bases.some((base) =>
    moduleSuffixes.some((suffix) => existsSync(resolve(base, rest + suffix))),
  );
}

const pnpmCommands = new Set([
  "add",
  "approve-builds",
  "audit",
  "dlx",
  "exec",
  "i",
  "install",
  "list",
  "ls",
  "outdated",
  "peers",
  "rebuild",
  "remove",
  "store",
  "update",
  "why",
]);

/**
 * `pnpm <script>` and `pnpm --filter <package> <script>` invocations in inline or fenced code.
 * Built-in pnpm commands are not scripts.
 *
 * @param {string} markdown
 * @returns {{ filter: string; script: string }[]}
 */
export function extractPnpmScripts(markdown) {
  const { prose, code } = splitFences(markdown);
  const sources = [...prose.flatMap(inlineCode), ...code];
  /** @type {{ filter: string; script: string }[]} */
  const scripts = [];
  for (const source of sources) {
    for (const [, filter = "", script = ""] of source.matchAll(
      /(?:^|[\s;&|(`])pnpm\s+(?:--filter[\s=](\S+)\s+)?(?:run\s+)?([a-z][\w:.-]*)/gu,
    )) {
      if (!pnpmCommands.has(script)) {
        scripts.push({ filter, script });
      }
    }
  }
  return scripts;
}

/** @param {string} repositoryRoot */
function packageScripts(repositoryRoot) {
  /** @type {Map<string, Set<string>>} */
  const packages = new Map();
  for (const directory of ["", "apps", "packages"]) {
    const base = resolve(repositoryRoot, directory);
    const candidates =
      directory === ""
        ? [resolve(base, "package.json")]
        : existsSync(base)
          ? readDirectories(base).map((name) =>
              resolve(base, name, "package.json"),
            )
          : [];
    for (const path of candidates) {
      if (!existsSync(path)) continue;
      const manifest = readPackageScripts(path);
      packages.set(
        directory === "" ? "" : manifest.name,
        new Set(Object.keys(manifest.scripts)),
      );
    }
  }
  return packages;
}

/** @param {string} path */
function readDirectories(path) {
  return readdirSync(path, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

/**
 * Checks links, fragments, backticked paths and pnpm scripts in the given documents.
 *
 * @param {string} repositoryRoot
 * @param {string[]} documents repository-relative Markdown paths
 * @param {Set<string>} pathDocuments documents whose backticked paths are also checked
 * @returns {string[]}
 */
export function checkDocumentReferences(
  repositoryRoot,
  documents,
  pathDocuments = new Set(documents),
) {
  /** @type {string[]} */
  const failures = [];
  /** @type {Map<string, Set<string>>} */
  const anchorCache = new Map();
  const scripts = packageScripts(repositoryRoot);

  /** @param {string} path */
  const anchorsOf = (path) => {
    let anchors = anchorCache.get(path);
    if (!anchors) {
      anchors = markdownAnchors(readFileSync(path, "utf8"));
      anchorCache.set(path, anchors);
    }
    return anchors;
  };

  for (const document of documents) {
    const absolute = resolve(repositoryRoot, document);
    if (!existsSync(absolute)) {
      failures.push(`${document}: required document is missing`);
      continue;
    }
    const content = readFileSync(absolute, "utf8");

    for (const { file, fragment } of extractMarkdownLinks(content)) {
      const target = file === "" ? absolute : resolve(dirname(absolute), file);
      const label = `${file}${fragment ? `#${fragment}` : ""}`;
      if (!existsSync(target)) {
        failures.push(`${document}: local pointer does not resolve: ${file}`);
        continue;
      }
      if (
        fragment !== "" &&
        target.endsWith(".md") &&
        !/^L\d+/u.test(fragment) &&
        !anchorsOf(target).has(fragment.toLowerCase())
      ) {
        failures.push(`${document}: anchor does not resolve: ${label}`);
      }
    }

    const paths = pathDocuments.has(document) ? extractCodePaths(content) : [];
    for (const path of new Set(paths)) {
      if (resolvesCodePath(repositoryRoot, absolute, path) === false) {
        failures.push(`${document}: backticked path does not exist: ${path}`);
      }
    }

    for (const { filter, script } of extractPnpmScripts(content)) {
      const owner = scripts.get(filter);
      if (filter !== "" && owner === undefined) {
        continue;
      }
      if (!owner?.has(script)) {
        failures.push(
          `${document}: pnpm script does not exist: ${filter ? `--filter ${filter} ` : ""}${script}`,
        );
      }
    }
  }
  return [...new Set(failures)];
}
