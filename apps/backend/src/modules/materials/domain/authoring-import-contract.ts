/**
 * The import contract this receiver accepts. The authoring client reads it from
 * `GET /authoring/import/materials/environment` and refuses before any write when its contract
 * version or one of its package features is not listed here.
 *
 * This file has no imports and only erasable TypeScript syntax: tooling imports it directly with
 * native type stripping.
 */
export const authoringImportContract = {
  version: 2,
  packageFeatures: [
    "canonical-product-source-v2",
    "material-task-v1",
    "task-c-v2",
    "github-anchors-v1",
    "image-variants-v1",
    "collapsible-callouts-v1",
    "bounded-content-v1",
    // A Material image may be an SVG: the receiver checks it and stores it as SVG (#2025).
    "svg-images-v1",
    // A Product may carry its course topics; the client writes them through
    // PUT /authoring/products/:productId/topics (#2022).
    "product-topics-v1",
    // A lesson apply may carry `updateNote: { id, whatChanged }`, a substantial update readers
    // who studied the lesson earlier are told about (#2125).
    "material-update-note-v1",
    // A package may carry the Glossary and Materials may mention its terms as `term:<id>` and
    // show a `> [!definition] term:<id>` card; the client writes it through
    // PUT /authoring/glossary (#2126).
    "glossary-v1",
    // Materials may carry Lesson Exercises (`quiz`, `match`, `order`) in `readerBlocks`, the
    // single exercise shape of content-studio#86; it replaces quiz-v1 and quiz-multiple-v1 (#2120).
    "exercise-v1",
    // `readerBlocks` may carry `{ kind: "step-break", label }` between two parts of a lesson
    // (content-studio#87). The receiver stores it; the reader opens parts one by one (#2122).
    "step-breaks-v1",
    // A Product may carry its course roadmap; the client writes it through
    // PUT /authoring/products/:productId/roadmap (#2141).
    "product-roadmap-v1",
  ],
} as const;
