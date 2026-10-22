/**
 * The import contract this receiver accepts. The authoring client reads it from
 * `GET /authoring/import/materials/environment` and refuses before any write when its contract
 * version or one of its package features is not listed here.
 *
 * This file has no imports and only erasable TypeScript syntax: tooling imports it directly with
 * native type stripping.
 */
export const authoringImportContract = {
  version: 1,
  packageFeatures: [
    "material-task-v1",
    "task-c-v2",
    "quiz-v1",
    "quiz-multiple-v1",
    "github-anchors-v1",
    "image-variants-v1",
    "collapsible-callouts-v1",
    "bounded-content-v1",
  ],
} as const;
