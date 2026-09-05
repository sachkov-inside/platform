import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

export function writeTrustedReleaseEvidence(
  root,
  { manifest, publicationRunId, sourceSha, version },
) {
  const evidenceRoot = resolve(
    root,
    "etc/inside/test-release-trust",
    version,
  );
  mkdirSync(evidenceRoot, { recursive: true });
  writeFileSync(
    resolve(evidenceRoot, "github-release.json"),
    `${JSON.stringify({
      assets: [
        {
          browser_download_url: `https://github.com/sachkov-inside/platform/releases/download/${version}/release-manifest.json`,
          name: "release-manifest.json",
        },
        {
          browser_download_url: `https://github.com/sachkov-inside/platform/releases/download/${version}/production-runtime.tar.gz`,
          name: "production-runtime.tar.gz",
        },
      ],
      draft: false,
      immutable: true,
      prerelease: false,
      tag_name: version,
      target_commitish: sourceSha,
    })}\n`,
  );
  writeFileSync(resolve(evidenceRoot, "release-manifest.json"), manifest);
  writeFileSync(
    resolve(evidenceRoot, "publication-run.json"),
    `${JSON.stringify({
      conclusion: "success",
      event: "workflow_dispatch",
      head_sha: sourceSha,
      id: publicationRunId,
      path: ".github/workflows/release.yml",
    })}\n`,
  );
}
