---
status: accepted
---

# One block registry package behind the MaterialBody seam

Cross-repository
[ADR 0004](https://github.com/sachkov-inside/workspace/blob/main/docs/adr/0004-typed-blocks-for-interactive-materials.md)
put interactive materials on typed blocks and named Platform the owner of the block registry. The
owner confirmed on 2026-09-11 that the foundation lands as one change
([#501](https://github.com/sachkov-inside/platform/issues/501)).

[ADR 0009](0009-one-mutable-material.md) deferred a separate content-schema seam until an
independent caller proved it. Three callers now hold their own copy of the same description: the
server builds a ProseMirror schema, the editor builds a second one, and the reading client repeats
the rendered block shape with its own validation. A fourth copy sits in the transport contract.
Any pair drifting apart rejects a save with `document_would_be_normalized`, so the seam is proven.

Platform therefore owns one workspace package, `@inside/material-blocks`, with two entry points.
The registry entry describes every block once — node type, fields, field rules, rendered shape,
search text and headings — and depends on no editor library. The document-schema entry builds the
ProseMirror schema and Tiptap extensions from that registry and is the only Tiptap importer;
the server and the editor both build from it, and the reading path imports the registry alone.

`MaterialBodyOperations` stays the single point of acceptance, rendering and extraction, and the
`Materials` module keeps owning document limits, node identity, canonicalization and versioning.
The registry describes blocks; it does not accept or store documents.

## Consequences

- Adding a block is one entry in the registry — its own file, its variant in the rendered union
  and its line in the registry list — plus its appearance in the reading and editing surfaces.
  The union stays hand-written because a recursive block type cannot be inferred from the schemas
  that describe it; the compiler rejects a definition whose `kind` the union does not declare.
- The package is the repository's first workspace package with a build step. It compiles during
  `pnpm install` and again at the head of `pnpm check`, so a fresh clone, CI and both container
  images have its output before anything reads it, at the cost of an install-time compile and its
  sources joining the dependency image layer.
- Applications no longer declare document nodes. `check-backend-architecture` and
  `check-web-architecture` fail on a Tiptap block declaration inside an application, and
  `check-material-blocks-boundary` fails when the registry entry point reaches Tiptap, which is
  what keeps the editor bundle out of the reading and lightweight authoring routes.
- The published transport contract still enumerates the inline `video` block the document schema
  stopped accepting. It is declared once, at the wire boundary, as a legacy variant; removing it
  is a separate contract change.
- Markdown writing per block, named in ADR 0004 and in the outcome of
  [#501](https://github.com/sachkov-inside/platform/issues/501), is not part of the registry yet:
  no block has a Markdown form today, so there is nothing to gather, and inventing one would be new
  behaviour. It arrives with the new blocks and the Obsidian import profile.
