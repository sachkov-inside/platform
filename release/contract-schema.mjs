import { z } from "zod";

export const repositoryName = "sachkov-inside/platform";
export const backendImageName = "ghcr.io/sachkov-inside/platform-backend";
export const webImageName = "ghcr.io/sachkov-inside/platform-web";
export const releaseAssetNames = [
  "release-manifest.json",
  "backend.provenance.bundle.json",
  "backend.sbom.bundle.json",
  "backend.sbom.spdx.json",
  "backend.vulnerabilities.json",
  "web.provenance.bundle.json",
  "web.sbom.bundle.json",
  "web.sbom.spdx.json",
  "web.vulnerabilities.json",
];

const lowercaseHex = (value) => value === value.toLowerCase();
const isAsciiDigits = (value) =>
  value.length > 0 &&
  [...value].every((digit) => digit >= "0" && digit <= "9");
const isOrdinalVersion = (value) => {
  if (!value.startsWith("v")) {
    return false;
  }
  const digits = value.slice(1);
  if (
    digits.length === 0 ||
    digits.startsWith("0") ||
    !isAsciiDigits(digits)
  ) {
    return false;
  }
  return Number.isSafeInteger(Number(digits));
};
const hasGitHubPath = (value, expectedPath) => {
  const url = new URL(value);
  return url.origin === "https://github.com" && url.pathname === expectedPath;
};

export const ordinalVersionSchema = z
  .templateLiteral(["v", z.int()])
  .refine(isOrdinalVersion, "release version must be vN with a positive ordinal");
export const sourceShaSchema = z
  .hex()
  .length(40)
  .refine(lowercaseHex, "source SHA must be a full lowercase Git commit SHA");
export const sha256DigestSchema = z
  .templateLiteral(["sha256:", z.hash("sha256")])
  .refine(lowercaseHex, "value must be a lowercase sha256 digest");

export const imageIdentitySchema = z.strictObject({
  digest: sha256DigestSchema,
  name: z.enum([backendImageName, webImageName]),
});

export const attestationSchema = z
  .strictObject({
    id: z.templateLiteral([z.int().nonnegative()]),
    url: z.url(),
  })
  .refine(
    ({ id, url }) =>
      isAsciiDigits(id) &&
      hasGitHubPath(url, `/${repositoryName}/attestations/${id}`),
    "attestation identity is invalid",
  );

export const workflowIdentitySchema = z.strictObject({
  actor: z.string().min(1),
  runUrl: z
    .url()
    .refine(
      (value) => {
        const runId = new URL(value).pathname.split("/").at(-1) ?? "";
        return (
          isAsciiDigits(runId) &&
          hasGitHubPath(value, `/${repositoryName}/actions/runs/${runId}`)
        );
      },
      "workflow run URL is invalid",
    ),
});

export const waiverSchema = z.strictObject({
  actor: z.string().min(1),
  reason: z.string().trim().min(20).max(1000),
  runUrl: workflowIdentitySchema.shape.runUrl,
});

const sbomEvidenceSchema = z.strictObject({
  attestation: attestationSchema,
  bundleSha256: sha256DigestSchema,
  documentSha256: sha256DigestSchema,
});
const provenanceEvidenceSchema = z.strictObject({
  attestation: attestationSchema,
  bundleSha256: sha256DigestSchema,
});
const vulnerabilityEvidenceSchema = z
  .strictObject({
    critical: z.int().min(0),
    decision: z.enum(["passed", "waived"]),
    high: z.int().min(0),
    reportSha256: sha256DigestSchema,
    waiver: waiverSchema.nullable(),
  })
  .refine(
    ({ critical, decision, high, waiver }) => {
      const hasFindings = critical > 0 || high > 0;
      return hasFindings
        ? decision === "waived" && waiver !== null
        : decision === "passed" && waiver === null;
    },
    "vulnerability decision is inconsistent with its findings",
  );
const evidenceAssetSchema = z.strictObject({
  provenanceBundle: z.string().min(1),
  sbomBundle: z.string().min(1),
  sbomDocument: z.string().min(1),
  vulnerabilityReport: z.string().min(1),
});

export const normalizedEvidenceSchema = z.strictObject({
  image: imageIdentitySchema,
  provenance: provenanceEvidenceSchema,
  sbom: sbomEvidenceSchema,
  sourceSha: sourceShaSchema,
  vulnerabilities: vulnerabilityEvidenceSchema,
});

const releasedImageEvidenceSchema = normalizedEvidenceSchema.extend({
  assets: evidenceAssetSchema,
});
const treeIdentitySchema = z.strictObject({
  digest: sha256DigestSchema,
  files: z.array(z.string().min(1)).min(1),
});

export const releaseManifestSchema = z
  .strictObject({
    schemaVersion: z.literal("inside.platform.release-manifest.v1"),
    version: ordinalVersionSchema,
    ordinal: z.int().positive(),
    source: z.strictObject({
      repository: z.literal(repositoryName),
      sha: sourceShaSchema,
    }),
    workflow: workflowIdentitySchema,
    identities: z.strictObject({
      migrations: treeIdentitySchema,
      configuration: treeIdentitySchema,
    }),
    images: z.strictObject({
      backend: releasedImageEvidenceSchema.extend({
        image: imageIdentitySchema.extend({ name: z.literal(backendImageName) }),
      }),
      web: releasedImageEvidenceSchema.extend({
        image: imageIdentitySchema.extend({ name: z.literal(webImageName) }),
      }),
    }),
  })
  .refine(
    ({ ordinal, version }) => ordinal === Number(version.slice(1)),
    "manifest ordinal must match its version",
  )
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
export const releaseEvidenceInputSchema = z.strictObject({
  image: imageIdentitySchema,
  sourceSha: sourceShaSchema,
  sbomPath: filePathSchema,
  vulnerabilityPath: filePathSchema,
  provenanceBundlePath: filePathSchema,
  provenanceVerificationPath: filePathSchema,
  provenanceAttestation: attestationSchema,
  sbomBundlePath: filePathSchema,
  sbomVerificationPath: filePathSchema,
  sbomAttestation: attestationSchema,
  waiver: waiverSchema.nullable(),
});

export const releaseAssetInputSchema = z.strictObject({
  evidencePath: filePathSchema,
  provenanceBundlePath: filePathSchema,
  sbomBundlePath: filePathSchema,
  sbomPath: filePathSchema,
  vulnerabilityPath: filePathSchema,
});

export const releaseManifestInputSchema = z.strictObject({
  version: ordinalVersionSchema,
  sourceSha: sourceShaSchema,
  repository: z.literal(repositoryName),
  workflow: workflowIdentitySchema,
  identityInputsPath: filePathSchema,
  images: z.strictObject({
    backend: filePathSchema,
    web: filePathSchema,
  }),
});

export const identityInputsSchema = z.strictObject({
  configuration: z.array(z.string().min(1)).min(1),
  migrations: z.array(z.string().min(1)).min(1),
});

export const spdxDocumentSchema = z.looseObject({
  spdxVersion: z.literal("SPDX-2.3"),
  SPDXID: z.literal("SPDXRef-DOCUMENT"),
  packages: z.array(z.unknown()),
});
export const sigstoreBundleSchema = z.looseObject({
  mediaType: z.string().min(1),
  verificationMaterial: z.object({}),
  dsseEnvelope: z.object({}),
});
export const vulnerabilityReportSchema = z.looseObject({
  matches: z.array(
    z.looseObject({
      vulnerability: z.looseObject({ severity: z.string().optional() }).optional(),
    }),
  ),
});
const verifiedStatementSchema = z.looseObject({
  subject: z.array(
    z.looseObject({
      name: z.string(),
      digest: z.looseObject({ sha256: z.hash("sha256") }),
    }),
  ),
  predicateType: z.url(),
  predicate: z.unknown(),
});
export const attestationVerificationSchema = z
  .array(
    z.looseObject({
      verificationResult: z.looseObject({ statement: verifiedStatementSchema }),
    }),
  )
  .min(1);
export function parseSchema(schema, value, label) {
  const result = schema.safeParse(value);
  if (result.success) {
    return result.data;
  }
  const issue = result.error.issues[0];
  const path = issue.path.length > 0 ? ` at ${issue.path.join(".")}` : "";
  throw new Error(`${label}${path}: ${issue.message}`);
}
