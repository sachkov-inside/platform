import { z } from "zod";

export const repositoryName = "sachkov-inside/platform";
export const backendImageName = "ghcr.io/sachkov-inside/platform-backend";
export const webImageName = "ghcr.io/sachkov-inside/platform-web";
export const releaseManifestAssetName = "release-manifest.json";
export const releaseAssetNames = [releaseManifestAssetName];
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
