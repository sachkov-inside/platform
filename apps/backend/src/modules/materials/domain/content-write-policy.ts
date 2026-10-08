import type {
  ForbiddenError,
  InvalidReferenceError,
} from "../facets/material-authoring/material-authoring.contract.js";

export interface ContentWriter {
  readonly via: "editor" | "mcp" | "import";
  readonly sourceId: string | null;
}

export interface ContentWriteTarget {
  readonly kind:
    "material" | "product" | "cover" | "artifact" | "membership" | "archive";
  readonly sourceId: string | null;
  readonly path: string;
}

/** Ownership is independent of actor authorization. Call once with locked facts before writing. */
export function checkContentWrite(
  writer: ContentWriter,
  targets: readonly ContentWriteTarget[],
): ForbiddenError | InvalidReferenceError | null {
  const importing = writer.via === "import";
  const issues: { code: string; path: string }[] = [];
  for (const target of targets) {
    if (target.kind === "archive") {
      if (importing) return { code: "forbidden" };
    } else if (target.kind === "membership") {
      // Product and Material have distinct source identities. Composition shares the ownership class.
      if ((target.sourceId !== null) !== importing)
        issues.push({ code: "material_source_mismatch", path: target.path });
    } else if (
      target.sourceId !== (importing ? writer.sourceId : null) ||
      (importing && writer.sourceId === null)
    ) {
      return { code: "forbidden" };
    }
  }
  return issues.length === 0 ? null : { code: "invalid_reference", issues };
}

/** REST and MCP use the same Platform ownership; their authentication stays in the adapter. */
export function contentWriter(sourceId: string | null = null): ContentWriter {
  return { via: sourceId === null ? "editor" : "import", sourceId };
}
