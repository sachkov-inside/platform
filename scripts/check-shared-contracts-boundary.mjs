// @ts-check
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { parseSync, Visitor } from "oxc-parser";

const root = path.resolve(process.argv[2] ?? ".");
const authority = path.join(root, "docs/contracts");
const ignored = new Set([
  "node_modules",
  "dist",
  ".next",
  "coverage",
  "storybook-static",
  ".git",
]);
const schemaIdentity = z.object({ $id: z.string() }).passthrough();
/** @param {string} directory @returns {string[]} */
function files(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory())
      return ignored.has(entry.name) ||
        file === path.join(root, "docs/history") ||
        file === path.join(root, "docs/research")
        ? []
        : files(file);
    return entry.isFile() &&
      /\.(json|md|txt|[cm]?ts|tsx|[cm]?js)$/u.test(entry.name)
      ? [file]
      : [];
  });
}
/** @param {string} file */
function digest(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}
/** @param {string} file */
function identity(file) {
  if (file.endsWith(".json")) {
    const parsed = schemaIdentity.safeParse(
      JSON.parse(readFileSync(file, "utf8")),
    );
    return parsed.success ? [parsed.data.$id] : [];
  }
  // This generator owns activation's Zod-to-JSON identity; contracts:check validates its output.
  if (
    file ===
    path.join(root, "apps/backend/scripts/generate-subscription-contracts.ts")
  )
    return [];
  if (!/\.([cm]?ts|tsx|[cm]?js)$/u.test(file)) return [];
  const { program, errors } = parseSync(file, readFileSync(file, "utf8"));
  if (errors.length > 0) throw new SyntaxError(`Cannot parse ${file}`);
  /** @type {string[]} */
  const ids = [];
  new Visitor({
    Property(node) {
      const key =
        node.key.type === "Identifier"
          ? node.key.name
          : node.key.type === "Literal"
            ? node.key.value
            : undefined;
      if (
        key === "$id" &&
        node.value.type === "Literal" &&
        typeof node.value.value === "string"
      )
        ids.push(node.value.value);
    },
  }).visit(program);
  return ids;
}
const wireContent = z.object({
  content: z.object({ "application/json": z.object({ schema: z.unknown() }) }),
});
const apiOperation = z
  .object({
    operationId: z.string(),
    requestBody: wireContent.optional(),
    responses: z.record(z.string(), z.unknown()),
  })
  .passthrough();
const openApiDocument = z.object({
  paths: z.record(z.string(), z.record(z.string(), z.unknown())),
});
/** Compare provider-owned projections with the checked OpenAPI generated from their runtime codecs. */
function providerDrift() {
  const contracts = [
    {
      directory: "platform-billing-cohorts",
      operationId: "billingProductCohorts",
      response: "response",
      request: false,
    },
    {
      directory: "inside-sales-funnel-events-v1",
      operationId: "recordSalesFunnelBotEvents",
      response: "receipt",
      request: true,
    },
  ].filter((contract) =>
    existsSync(path.join(authority, contract.directory, "schema.json")),
  );
  if (contracts.length === 0) return [];
  const api = openApiDocument.parse(
    JSON.parse(
      readFileSync(
        path.join(root, "apps/backend/openapi/platform-api.json"),
        "utf8",
      ),
    ),
  );
  const operations = Object.values(api.paths).flatMap((path) =>
    Object.values(path),
  );
  return contracts.flatMap((contract) => {
    const parsed = operations
      .map((operation) => apiOperation.safeParse(operation))
      .find(
        (operation) =>
          operation.success &&
          operation.data.operationId === contract.operationId,
      );
    const file = path.join(authority, contract.directory, "schema.json");
    const schema = z
      .record(z.string(), z.unknown())
      .parse(JSON.parse(readFileSync(file, "utf8")));
    if (parsed === undefined || !parsed.success)
      return [
        `${path.relative(root, file)}: missing OpenAPI operation ${contract.operationId}`,
      ];
    const operation = parsed.data;
    const matches =
      isDeepStrictEqual(
        schema[contract.response],
        wireContent.parse(operation.responses["200"]).content[
          "application/json"
        ].schema,
      ) &&
      (!contract.request ||
        isDeepStrictEqual(
          schema["request"],
          operation.requestBody?.content["application/json"].schema,
        ));
    return matches
      ? []
      : [
          `${path.relative(root, file)}: drift from OpenAPI operation ${contract.operationId}; update the shared corpus from the current generated API`,
        ];
  });
}
const canonical = files(authority).filter(
  (file) => !/\/(package|manifest|snapshot|provenance)\.json$/u.test(file),
);
/** @type {Map<string, string>} */
const digests = new Map();
/** @type {Map<string, string>} */
const identities = new Map();
/** @type {string[]} */
const duplicateSources = [];
for (const file of canonical) {
  const hash = digest(file);
  const ids = identity(file);
  const owner =
    digests.get(hash) ??
    ids.map((id) => identities.get(id)).find((file) => file !== undefined);
  if (owner !== undefined)
    duplicateSources.push(
      `${path.relative(root, file)}: duplicates canonical contract ${path.relative(root, owner)}`,
    );
  digests.set(hash, file);
  for (const id of ids) identities.set(id, file);
}
const corpusNames = new Set(
  readdirSync(authority, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name),
);
const findings = duplicateSources.concat(
  providerDrift(),
  ["apps", "packages", "docs"]
    .flatMap((directory) => files(path.join(root, directory)))
    .filter((file) => !file.startsWith(`${authority}${path.sep}`))
    .flatMap((file) => {
      const ids = identity(file);
      const owner =
        digests.get(digest(file)) ??
        ids.map((id) => identities.get(id)).find((file) => file !== undefined);
      const relative = path.relative(root, file);
      const copiedFolder = relative
        .split(path.sep)
        .some((part) => corpusNames.has(part));
      return owner !== undefined || copiedFolder
        ? [
            `${relative}: shared contract belongs to ${owner === undefined ? "docs/contracts" : path.relative(root, owner)}; import @inside/contracts instead of copying it`,
          ]
        : [];
    }),
);
if (findings.length > 0) {
  process.stderr.write(`${findings.sort().join("\n")}\n`);
  process.exitCode = 1;
} else process.stdout.write("Shared contracts boundary passed.\n");
