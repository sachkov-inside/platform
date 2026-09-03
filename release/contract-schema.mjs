import { z } from "zod";

export const repositoryName = "sachkov-inside/platform";
export const backendImageName = "ghcr.io/sachkov-inside/platform-backend";
export const webImageName = "ghcr.io/sachkov-inside/platform-web";
export const releaseAssetNames = [
  "release-manifest.json",
  "backend.vulnerabilities.json",
  "web.vulnerabilities.json",
];

export const ordinalVersionSchema = z
  .string()
  .regex(/^v[1-9][0-9]*$/, "release version must be vN with a positive ordinal")
  .refine(
    (value) => Number.isSafeInteger(Number(value.slice(1))),
    "release ordinal exceeds the safe integer range",
  );
export const sourceShaSchema = z.hex().length(40).lowercase();
export const sha256DigestSchema = z.intersection(
  z.templateLiteral(["sha256:", z.hash("sha256")]),
  z.string().lowercase(),
);

const workflowRunUrlSchema = z
  .url()
  .regex(
    /^https:\/\/github[.]com\/sachkov-inside\/platform\/actions\/runs\/[1-9][0-9]*$/,
  );

export const imageIdentitySchema = z.strictObject({
  digest: sha256DigestSchema,
  name: z.enum([backendImageName, webImageName]),
});

export const waiverSchema = z.strictObject({
  actor: z.string().min(1),
  reason: z.string().trim().min(20).max(1000),
  runUrl: workflowRunUrlSchema,
});
export const releaseWaiverInputSchema = z.strictObject({
  actor: waiverSchema.shape.actor,
  reason: z.string(),
  runUrl: waiverSchema.shape.runUrl,
});

export const releaseImageResultSchema = z.strictObject({
  image: imageIdentitySchema,
  sourceSha: sourceShaSchema,
  vulnerabilityWaiver: waiverSchema.nullable(),
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
    schemaVersion: z.literal("inside.platform.release-manifest.v1"),
    version: ordinalVersionSchema,
    source: z.strictObject({
      repository: z.literal(repositoryName),
      sha: sourceShaSchema,
    }),
    images: z.strictObject({
      backend: imageReferenceSchema(backendImageName),
      web: imageReferenceSchema(webImageName),
    }),
    vulnerabilityWaiver: waiverSchema.nullable(),
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
