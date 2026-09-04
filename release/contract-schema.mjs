import { z } from "zod";

import {
  ordinalReleaseSchema,
  sha256IdentitySchema,
  sourceShaSchema as runtimeSourceShaSchema,
} from "../packages/runtime-identity/index.mjs";

export const repositoryName = "sachkov-inside/platform";
export const backendImageName = "ghcr.io/sachkov-inside/platform-backend";
export const webImageName = "ghcr.io/sachkov-inside/platform-web";
export const releaseManifestAssetName = "release-manifest.json";
export const productionRuntimeBundleAssetName = "production-runtime.tar.gz";
export const releaseAssetNames = [
  releaseManifestAssetName,
  productionRuntimeBundleAssetName,
];
export const releaseImageMatrix = [
  {
    kind: "backend",
    dockerfile: "apps/backend/Dockerfile",
    target: "backend-production",
    imageName: backendImageName,
  },
  {
    kind: "web",
    dockerfile: "apps/web/Dockerfile",
    target: "web-production",
    imageName: webImageName,
  },
];

export const ordinalVersionSchema = ordinalReleaseSchema;
export const sourceShaSchema = runtimeSourceShaSchema;
export const sha256DigestSchema = sha256IdentitySchema;

export const imageIdentitySchema = z.strictObject({
  digest: sha256DigestSchema,
  name: z.enum([backendImageName, webImageName]),
});

export const releaseImageResultSchema = z.strictObject({
  image: imageIdentitySchema,
  sourceSha: sourceShaSchema,
});

const imageReferenceSchema = (imageName) =>
  z.intersection(
    z.templateLiteral([
      z.literal(imageName),
      "@sha256:",
      z.hash("sha256"),
    ]),
    z.string().lowercase(),
  );

export const releaseManifestSchema = z
  .strictObject({
    schemaVersion: z.literal("inside.platform.release-manifest.v2"),
    version: ordinalVersionSchema,
    source: z.strictObject({
      repository: z.literal(repositoryName),
      sha: sourceShaSchema,
    }),
    images: z.strictObject({
      backend: imageReferenceSchema(backendImageName),
      web: imageReferenceSchema(webImageName),
    }),
    schema: z.strictObject({
      identity: sha256IdentitySchema,
    }),
    runtimeBundle: z.strictObject({
      asset: z.literal(productionRuntimeBundleAssetName),
      sha256: sha256IdentitySchema,
    }),
    publication: z.strictObject({
      workflowRunId: z.number().int().positive(),
    }),
    rollback: z.strictObject({
      previous: z.union([
        z.null(),
        z.strictObject({
          version: ordinalVersionSchema,
          sourceSha: sourceShaSchema,
          manifestSha256: sha256IdentitySchema,
          schemaIdentity: sha256IdentitySchema,
          compatible: z.boolean(),
          verifiedByWorkflowRunId: z.number().int().positive(),
        }),
      ]),
    }),
  })
  .meta({ title: "Inside Platform ordinal release manifest" });

const releasedOrdinalSchema = z.strictObject({
  assets: z.array(z.string().min(1)),
  immutable: z.boolean(),
  version: z.string().min(1),
});
export const releasePlanInputSchema = z.strictObject({
  requestedVersion: ordinalVersionSchema,
  sourceSha: sourceShaSchema,
  currentMainSha: sourceShaSchema,
  existingTags: z.array(z.string().min(1)),
  existingReleases: z.array(releasedOrdinalSchema),
});

const filePathSchema = z.string().min(1);
export const releaseManifestInputSchema = z.strictObject({
  version: ordinalVersionSchema,
  sourceSha: sourceShaSchema,
  repository: z.literal(repositoryName),
  images: z.strictObject({
    backend: filePathSchema,
    web: filePathSchema,
  }),
  schemaIdentity: sha256IdentitySchema,
  runtimeBundle: filePathSchema,
  publicationWorkflowRunId: z.number().int().positive(),
  rollback: z.strictObject({
    previous: z.union([
      z.null(),
      z.strictObject({
        manifest: filePathSchema,
        schemaIdentity: sha256IdentitySchema,
      }),
    ]),
  }),
});

export function parseSchema(schema, value, label) {
  const result = schema.safeParse(value);
  if (result.success) {
    return result.data;
  }
  const issue = result.error.issues[0];
  const path = issue.path.length > 0 ? ` at ${issue.path.join(".")}` : "";
  throw new Error(`${label}${path}: ${issue.message}`);
}
