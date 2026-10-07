// @ts-check
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { releaseManifestSchema } from "../../release/contract-schema.mjs";
import {
  ordinalReleaseSchema,
  sourceShaSchema,
  sha256IdentitySchema,
} from "../../packages/runtime-identity/index.mjs";
import {
  imageName,
  manifestSchemaVersion,
  repository,
} from "../../apps/telegram/scripts/release-contract.mjs";

const imageReference = z.intersection(
  z.templateLiteral([imageName, "@sha256:", z.hash("sha256")]),
  z.string().lowercase(),
);
const telegramManifest = z.strictObject({
  schemaVersion: z.literal(manifestSchemaVersion),
  version: ordinalReleaseSchema,
  source: z.strictObject({
    repository: z.literal(repository),
    sha: sourceShaSchema,
  }),
  image: imageReference,
  migrations: z.strictObject({
    identity: sha256IdentitySchema,
    count: z.int().positive(),
    latest: z.string().min(1),
  }),
  compose: z.strictObject({
    asset: z.literal("compose.yaml"),
    sha256: sha256IdentitySchema,
  }),
  caddy: z.strictObject({
    asset: z.literal("telegram.caddy"),
    sha256: sha256IdentitySchema,
  }),
  publication: z.strictObject({
    workflowRunId: z.int().positive(),
    workflowRunUrl: z.url({ protocol: /^https$/u, hostname: /^github\.com$/u }),
  }),
});
const deployed = z.object({
  version: ordinalReleaseSchema,
  sourceSha: sourceShaSchema,
  manifestSha256: sha256IdentitySchema,
});
const platformDeployed = deployed.extend({
  backendImage: releaseManifestSchema.shape.images.shape.backend,
  webImage: releaseManifestSchema.shape.images.shape.web,
  schemaIdentity: sha256IdentitySchema,
});
const rollback = z.object({
  targetVersion: ordinalReleaseSchema,
  compatible: z.boolean(),
  sourceSha: sourceShaSchema,
  manifestSha256: sha256IdentitySchema,
  schemaIdentity: sha256IdentitySchema,
  verifiedByWorkflowRunId: z.int().positive(),
});
const platformState = z.object({
  schemaVersion: z.literal("inside.platform.deployment-state.v1"),
  status: z.literal("succeeded"),
  operation: z.enum(["deploy", "rollback"]),
  current: platformDeployed,
  previous: platformDeployed.nullable(),
  rollback: rollback.nullable(),
  rolledBackFrom: platformDeployed.nullable(),
});
const telegramDeployed = deployed.extend({
  image: imageReference,
  migrationsIdentity: sha256IdentitySchema,
  operation: z.enum(["deploy", "rollback"]),
  githubRunId: z.int().positive(),
  completedAt: z.iso.datetime(),
});
const telegramState = z.object({
  schemaVersion: z.literal("inside.telegram.deployment-state.v1"),
  current: telegramDeployed,
  previous: telegramDeployed.nullable(),
});
const context = z.strictObject({
  application: z.enum(["platform", "telegram"]),
  version: ordinalReleaseSchema,
  manifestRaw: z.string(),
  stateRaw: z.string(),
});

/** Validates public journals before the Python collector consumes their fields.
 * @param {unknown} input
 * @returns {boolean}
 */
export function validateContext(input) {
  try {
    const parsed = context.parse(input);
    /** @type {unknown} */
    const manifestInput = JSON.parse(parsed.manifestRaw);
    /** @type {unknown} */
    const stateInput = JSON.parse(parsed.stateRaw);
    const manifest =
      parsed.application === "platform"
        ? releaseManifestSchema.parse(manifestInput)
        : telegramManifest.parse(manifestInput);
    if (parsed.application === "platform") platformState.parse(stateInput);
    else telegramState.parse(stateInput);
    return manifest.version === parsed.version;
  } catch {
    return false;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  let input = "";
  for await (const chunk of process.stdin) input += String(chunk);
  /** @type {unknown} */
  let value;
  try {
    value = JSON.parse(input);
  } catch {
    value = null;
  }
  const valid = validateContext(value);
  console.log(JSON.stringify({ valid }));
  process.exitCode = valid ? 0 : 1;
}
