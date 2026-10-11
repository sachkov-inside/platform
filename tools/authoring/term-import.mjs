// @ts-check
import { z } from "zod";
import { termDefinitionSchema } from "@inside/material-blocks";
import { canonical, checksum } from "./package.mjs";
import { convertMarkdown, sourceUuid } from "./markdown.mjs";
import { prepareTermReferences } from "./term-references.mjs";
import { applyJournaled } from "./journal.mjs";
import { isJournalOperation, termReceiptSchema } from "./local-boundaries.mjs";

const version = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const bodySchema = z
  .object({
    definition: termDefinitionSchema,
    publicationState: z.enum(["draft", "published", "unpublished"]),
    source: z
      .object({
        id: z.string().min(1).max(200),
        path: z.string().min(1).max(1000),
        revision: z.hash("sha256"),
      })
      .strict(),
    expectedTermVersion: version.nullable(),
  })
  .strict();
const operationSchema = z
  .object({
    path: z.literal("/authoring/import/terms/apply"),
    body: bodySchema,
  })
  .strict();
const storedSchema = z
  .object({ termVersion: version, digest: z.hash("sha256") })
  .strict();
/** @typedef {{ termId: string; termVersion: number; status: "applied" | "unchanged" }} TermChange */
/** @typedef {{ key: string; body: z.infer<typeof bodySchema>; desired: string; unchanged: boolean; current: z.infer<typeof termReceiptSchema> | null }} PreparedTermImport */

/** Authored drafts stay drafts even under publish=all. Every published reference is checked before transfer writes.
 * @param {import('./package.mjs').Manifest} manifest
 * @param {(key: string) => "draft" | "published"} publicationOf
 * @returns {import('./package.mjs').Manifest} */
export function termsForTransfer(manifest, publicationOf) {
  if (manifest.terms === undefined) return manifest;
  const resolve = prepareTermReferences(
    manifest.terms.map((row) => ({
      definition: row.definition,
      publicationState: row.publicationState,
      available: true,
    })),
    { allowUnpublished: true },
  );
  const publishedIds = new Set();
  for (const material of [
    ...manifest.materials,
    ...(manifest.tasks ?? []).flatMap((task) =>
      task.page === undefined ? [] : [task.page],
    ),
  ]) {
    const published =
      publicationOf(`${manifest.sourceNamespace}:${material.sourceId}`) ===
      "published";
    convertMarkdown(material.markdown, {
      sourceId: material.sourceId,
      sourcePath: material.sourcePath,
      readerBlocks: material.readerBlocks,
      link: (href) => href,
      image: (src) => sourceUuid(src),
      term: (target) => {
        const reference = resolve(target);
        if (published) publishedIds.add(reference.termId);
        return reference;
      },
    });
  }
  return {
    ...manifest,
    terms: manifest.terms.map((row) => {
      if (publishedIds.has(row.definition.id.toLowerCase())) {
        if (row.publicationState !== "published")
          throw new Error(
            `${row.sourcePath}: Unpublished term referenced by a published Material`,
          );
        return row;
      }
      return row.publicationState === "published"
        ? { ...row, publicationState: "draft" }
        : row;
    }),
  };
}

/** @param {import('./package.mjs').Manifest} manifest
 * @param {NonNullable<import('./package.mjs').Manifest['terms']>[number]} row */
function commandOf(manifest, row) {
  return {
    definition: row.definition,
    publicationState: row.publicationState,
    source: {
      id: `${manifest.sourceNamespace}:${row.sourceId}`,
      path: row.sourcePath,
      revision: checksum(canonical(row)),
    },
  };
}
/** @param {z.infer<typeof bodySchema>} body */
function digest(body) {
  const { expectedTermVersion: _version, ...state } = body;
  return checksum(canonical(state));
}

/** @param {import('./package.mjs').Manifest} manifest
 * @param {import('./local-boundaries.mjs').LocalRequest} request */
export async function validateSourceTerms(manifest, request) {
  for (const row of manifest.terms ?? [])
    await request("/authoring/import/terms/validate", commandOf(manifest, row));
}

/** Historical replies recover only this journal's own requests. Publication changes never authorize replay.
 * @param {import('./package.mjs').Manifest} manifest
 * @param {import('./journal.mjs').JournalContext} context
 * @param {import('./local-boundaries.mjs').LocalRequest} request */
export async function replayTermImports(manifest, context, request) {
  const resources = (context.journal.resources ??= {});
  for (const entry of Object.values(context.journal.operations)) {
    if (!isJournalOperation(entry) || entry.status === "rejected") continue;
    const parsed = operationSchema.safeParse(entry.request);
    if (!parsed.success) continue;
    const operation = parsed.data;
    if (
      entry.status === "pending" &&
      operation.body.publicationState === "published" &&
      !manifest.terms?.some(
        (row) =>
          row.definition.id.toLowerCase() ===
            operation.body.definition.id.toLowerCase() &&
          row.publicationState === "published",
      )
    )
      throw new Error(
        `${operation.body.definition.id}: interrupted term publication requires the same publication approval`,
      );
    const key = `term:${operation.body.definition.id.toLowerCase()}`;
    const previous =
      resources[key] === undefined
        ? undefined
        : storedSchema.parse(resources[key]);
    if (
      entry.status === "applied" &&
      previous !== undefined &&
      previous.termVersion >= termReceiptSchema.parse(entry.result).termVersion
    )
      continue;
    const receipt = termReceiptSchema.parse(
      await applyJournaled(context, operation, (replayed, idempotencyKey) =>
        request(replayed.path, replayed.body, idempotencyKey),
      ),
    );
    resources[key] = {
      termVersion: receipt.termVersion,
      digest: digest(operation.body),
    };
    await context.persist();
  }
}

/** Inspect every target version before the first new definition write; never overwrite a manual edit or adopt another owner.
 * @param {import('./package.mjs').Manifest} manifest
 * @param {Record<string, unknown>} resources
 * @param {import('./local-boundaries.mjs').LocalRequest} request
 * @returns {Promise<PreparedTermImport[]>} */
async function prepareTermImports(manifest, resources, request) {
  /** @type {PreparedTermImport[]} */
  const pending = [];
  for (const row of manifest.terms ?? []) {
    const command = commandOf(manifest, row);
    const { current } = await request(
      "/authoring/import/terms/validate",
      command,
    );
    const key = `term:${row.definition.id.toLowerCase()}`;
    const previous =
      resources[key] === undefined
        ? undefined
        : storedSchema.parse(resources[key]);
    if (previous !== undefined && previous.termVersion !== current?.termVersion)
      throw new Error(
        `${row.definition.id}: target changed; reconcile before overwriting`,
      );
    if (
      previous === undefined &&
      current !== null &&
      (current.sourceId !== command.source.id ||
        current.sourceRevision !== command.source.revision ||
        current.publicationState !== command.publicationState)
    )
      throw new Error(
        `${row.definition.id}: target has an unreviewed version; reconcile before overwriting`,
      );
    const body = {
      ...command,
      expectedTermVersion: current?.termVersion ?? null,
    };
    const desired = digest(body);
    pending.push({
      key,
      body,
      desired,
      unchanged:
        current !== null &&
        (previous?.digest === desired ||
          (previous === undefined &&
            current.sourceRevision === command.source.revision)),
      current,
    });
  }
  return pending;
}

/** A release preview records current target versions and the desired state without writes.
 * @param {import('./package.mjs').Manifest} manifest
 * @param {import('./journal.mjs').Journal} journal
 * @param {import('./local-boundaries.mjs').LocalRequest} request */
export async function previewSourceTerms(manifest, journal, request) {
  const pending = await prepareTermImports(
    manifest,
    journal.resources ?? {},
    request,
  );
  return pending.map((item) => ({
    termId: item.body.definition.id,
    termVersion: item.current?.termVersion ?? null,
    publicationState: item.body.publicationState,
    change: item.unchanged
      ? "unchanged"
      : item.current === null
        ? "new"
        : "changed",
  }));
}

/** @param {import('./package.mjs').Manifest} manifest
 * @param {import('./journal.mjs').JournalContext} context
 * @param {import('./local-boundaries.mjs').LocalRequest} request
 * @returns {Promise<TermChange[]>} */
export async function syncSourceTerms(manifest, context, request) {
  const resources = (context.journal.resources ??= {});
  const pending = await prepareTermImports(manifest, resources, request);
  /** @type {TermChange[]} */
  const changes = [];
  for (const item of pending) {
    const receipt =
      item.unchanged && item.current !== null
        ? item.current
        : termReceiptSchema.parse(
            await applyJournaled(
              context,
              { path: "/authoring/import/terms/apply", body: item.body },
              (operation, idempotencyKey) =>
                request(operation.path, operation.body, idempotencyKey),
            ),
          );
    resources[item.key] = {
      termVersion: receipt.termVersion,
      digest: item.desired,
    };
    await context.persist();
    changes.push({
      termId: receipt.termId,
      termVersion: receipt.termVersion,
      status: item.unchanged ? "unchanged" : "applied",
    });
  }
  return changes;
}
