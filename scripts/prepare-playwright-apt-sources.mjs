// @ts-check
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";

const [sourceArgument, destinationArgument, mode] = process.argv.slice(2);
if (sourceArgument === undefined || destinationArgument === undefined)
  throw new Error(
    "Expected the APT source directory and an empty scope directory",
  );
const source = resolve(sourceArgument);
const destination = resolve(destinationArgument);
if (source === destination || readdirSync(destination).length !== 0)
  throw new Error(
    "The Playwright APT scope must be a separate empty directory",
  );

const microsoftFeed = new Set([
  "https://packages.microsoft.com/ubuntu/24.04/prod",
  "https://packages.microsoft.com/ubuntu/24.04/prod/",
]);
const mirror = "apt-mirrors.txt";
const hasMirror = existsSync(join(source, mirror));
const originalMirrorUri = `mirror+file:${join(source, mirror)}`;
const scopedMirrorUri = `mirror+file:${join(destination, mirror)}`;
const httpSecuritySource = /^http:\/\/security\.ubuntu\.com\/ubuntu\/?$/u;

/** @param {string} uri @param {boolean} securityPocket @param {"deb822" | "one-line"} format */
function scopedUri(uri, securityPocket, format) {
  if (securityPocket && httpSecuritySource.test(uri)) {
    const selected =
      mode === "--security-fallback"
        ? uri.replace(
            "http://security.ubuntu.com",
            "https://archive.ubuntu.com",
          )
        : uri;
    console.log(
      `Playwright APT ${format} source for noble-security: ${selected}`,
    );
    return selected;
  }
  return hasMirror && uri === originalMirrorUri ? scopedMirrorUri : uri;
}

/** @param {string} text */
function filterList(text) {
  return text
    .split(/(?<=\n)/u)
    .map((line) => {
      const entry =
        /^(\s*deb(?:-src)?\s+(?:\[[^\]\r\n]*\]\s+)?)(\S+)([\s\S]*)$/u.exec(
          line,
        );
      if (entry === null) return line;
      const [, prefix = "", uri = "", suffix = ""] = entry;
      return microsoftFeed.has(uri)
        ? ""
        : `${prefix}${scopedUri(uri, /^\s+noble-security(?:\s|$)/u.test(suffix), "one-line")}${suffix}`;
    })
    .join("");
}

/** @param {string} text */
function filterDeb822(text) {
  return text
    .split(/((?:\r?\n){2,})/u)
    .map((paragraph) => {
      if (/^Enabled:\s*no\s*$/imu.test(paragraph)) return paragraph;
      const fields = [
        ...paragraph.matchAll(/^URIs:[^\r\n]*(?:\r?\n[ \t][^\r\n]*)*/gimu),
      ];
      // Unknown layouts remain intact; an unexpected source must fail, never disappear.
      if (fields.length !== 1) return paragraph;
      const field = fields[0];
      if (field === undefined) return paragraph;
      const uriField = field[0];
      const uris = uriField
        .replace(/^URIs:\s*/iu, "")
        .trim()
        .split(/\s+/u);
      if (!uris.every((uri) => /^[a-z][a-z0-9+.-]*:/iu.test(uri)))
        return paragraph;
      const suites = /^Suites:([^\r\n]*(?:\r?\n[ \t][^\r\n]*)*)/imu.exec(
        paragraph,
      );
      const names = suites?.[1]?.trim().split(/\s+/u) ?? [];
      const securityPocket = names.includes("noble-security");
      const retained = uris.filter((uri) => !microsoftFeed.has(uri));
      if (retained.length === 0) return "";

      /** @param {string} stanza @param {boolean} forSecurity */
      function withUris(stanza, forSecurity) {
        const selected = retained.map((uri) =>
          scopedUri(uri, forSecurity, "deb822"),
        );
        if (
          selected.length === uris.length &&
          selected.every((uri, index) => uri === uris[index])
        )
          return stanza;
        return stanza.replace(uriField, `URIs: ${selected.join(" ")}`);
      }

      const otherSuites = names.filter((name) => name !== "noble-security");
      if (
        mode === "--security-fallback" &&
        suites !== null &&
        securityPocket &&
        otherSuites.length > 0 &&
        retained.some((uri) => httpSecuritySource.test(uri))
      ) {
        const other = paragraph.replace(
          suites[0],
          `Suites: ${otherSuites.join(" ")}`,
        );
        const security = paragraph.replace(suites[0], "Suites: noble-security");
        const newline = paragraph.includes("\r\n") ? "\r\n" : "\n";
        return (
          withUris(other, false).replace(/\r?\n$/u, "") +
          newline +
          newline +
          withUris(security, true)
        );
      }
      return withUris(paragraph, securityPocket);
    })
    .join("");
}

chmodSync(destination, 0o755);
mkdirSync(join(destination, "sources.list.d"), { mode: 0o755 });
/** @param {string} relative */
function copySources(relative) {
  const original = join(source, relative);
  const text = readFileSync(original, "utf8");
  const filtered = relative.endsWith(".sources")
    ? filterDeb822(text)
    : filterList(text);
  writeFileSync(join(destination, relative), filtered, {
    mode: statSync(original).mode & 0o777,
  });
}

if (existsSync(join(source, "sources.list"))) copySources("sources.list");
else writeFileSync(join(destination, "sources.list"), "", { mode: 0o644 });
const parts = join(source, "sources.list.d");
if (existsSync(parts)) {
  for (const name of readdirSync(parts)) {
    if (
      (name.endsWith(".list") || name.endsWith(".sources")) &&
      statSync(join(parts, name)).isFile()
    )
      copySources(join("sources.list.d", name));
  }
}
if (hasMirror)
  writeFileSync(join(destination, mirror), readFileSync(join(source, mirror)), {
    mode: statSync(join(source, mirror)).mode & 0o777,
  });

/** @param {string} value */
const quoted = (value) =>
  `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
// The installer passes this only to Playwright's process tree. A binary subtree
// would also move empty Dir/Etc parents and erase APT's normal root defaults.
writeFileSync(
  join(destination, "apt.conf"),
  [
    `Dir::Etc::sourcelist ${quoted(join(destination, "sources.list"))};`,
    `Dir::Etc::sourceparts ${quoted(join(destination, "sources.list.d"))};`,
    'APT::Get::List-Cleanup "false";',
    "",
  ].join("\n"),
  { mode: 0o644 },
);
