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

const isAsciiDigits = (value) =>
  value.length > 0 &&
  [...value].every((digit) => digit >= "0" && digit <= "9");
const hasGitHubPath = (value, expectedPath) => {
  const url = new URL(value);
  return url.origin === "https://github.com" && url.pathname === expectedPath;
};

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

const attestationIdSchema = z.string().regex(/^[1-9][0-9]*$/);
const attestationUrlSchema = z
  .url()
  .regex(
    /^https:\/\/github[.]com\/sachkov-inside\/platform\/attestations\/[1-9][0-9]*$/,
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

export const attestationSchema = z
  .strictObject({
    id: attestationIdSchema,
    url: attestationUrlSchema,
  })
  .refine(
    ({ id, url }) =>
      isAsciiDigits(id) &&
      hasGitHubPath(url, `/${repositoryName}/attestations/${id}`),
    "attestation identity is invalid",
  );

export const workflowIdentitySchema = z.strictObject({
  actor: z.string().min(1),
  runUrl: workflowRunUrlSchema,
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
const vulnerabilityEvidenceSchema = z.union([
  z.strictObject({
    critical: z.literal(0),
    decision: z.literal("passed"),
    high: z.literal(0),
    reportSha256: sha256DigestSchema,
    waiver: z.null(),
  }),
  z.strictObject({
    critical: z.int().min(0),
    decision: z.literal("waived"),
    high: z.int().positive(),
    reportSha256: sha256DigestSchema,
    waiver: waiverSchema,
  }),
  z.strictObject({
    critical: z.int().positive(),
    decision: z.literal("waived"),
    high: z.int().min(0),
    reportSha256: sha256DigestSchema,
    waiver: waiverSchema,
  }),
]);

export const normalizedEvidenceSchema = z.strictObject({
  image: imageIdentitySchema,
  provenance: provenanceEvidenceSchema,
  sbom: sbomEvidenceSchema,
  sourceSha: sourceShaSchema,
  vulnerabilities: vulnerabilityEvidenceSchema,
});

const treeIdentitySchema = z.strictObject({
  digest: sha256DigestSchema,
  files: z.array(z.string().min(1)).min(1),
});
const releasedAttestationSchema = z.strictObject({ url: attestationUrlSchema });
const releasedImageEvidenceSchema = (kind, imageName) =>
  z.strictObject({
    image: z.strictObject({
      digest: sha256DigestSchema,
      name: z.literal(imageName),
    }),
    provenance: z.strictObject({
      attestation: releasedAttestationSchema,
      bundleSha256: sha256DigestSchema,
    }),
    sbom: z.strictObject({
      attestation: releasedAttestationSchema,
      bundleSha256: sha256DigestSchema,
      documentSha256: sha256DigestSchema,
    }),
    vulnerabilities: vulnerabilityEvidenceSchema,
    assets: z.strictObject({
      provenanceBundle: z.literal(`${kind}.provenance.bundle.json`),
      sbomBundle: z.literal(`${kind}.sbom.bundle.json`),
      sbomDocument: z.literal(`${kind}.sbom.spdx.json`),
      vulnerabilityReport: z.literal(`${kind}.vulnerabilities.json`),
    }),
  });

export const releaseManifestSchema = z
  .strictObject({
    schemaVersion: z.literal("inside.platform.release-manifest.v1"),
    version: ordinalVersionSchema,
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
      backend: releasedImageEvidenceSchema("backend", backendImageName),
      web: releasedImageEvidenceSchema("web", webImageName),
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
