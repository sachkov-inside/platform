import { readFileSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";

import { z } from "zod";

const toolSurfaceSchema = z.array(z.string().min(1));

/** Слепок состава набора инструментов MCP: один путь и одна форма на все проверки. */
export const committedToolSurfacePath = fileURLToPath(
  new URL("../mcp/tool-surface.json", import.meta.url),
);

export function formatToolSurface(names: readonly string[]): string {
  return `${JSON.stringify(names, undefined, 2)}\n`;
}

export function parseToolSurface(content: string, source: string): string[] {
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    throw new Error(`MCP tool surface at ${source} is not valid JSON. Run \`pnpm mcp:generate\`.`);
  }
  const parsed = toolSurfaceSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`MCP tool surface at ${source} is not a list of tool names.`);
  }
  return parsed.data;
}

export function readCommittedToolSurface(): string[] {
  return parseToolSurface(
    readFileSync(committedToolSurfacePath, "utf8"),
    committedToolSurfacePath,
  );
}
