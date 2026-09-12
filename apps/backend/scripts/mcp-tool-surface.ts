import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { z } from "zod";

import { assembleInsideMcpServer } from "../src/entrypoints/mcp/inside-mcp-server.js";
import { stubMaterialAuthoring } from "../test/fixtures/material-authoring.js";

const toolSurfaceSchema = z.array(z.string().min(1));
const defaultSurfacePath = path.resolve("mcp/tool-surface.json");
const checkOnly = process.argv.includes("--check");
const surfacePath = readOption("--surface") ?? defaultSurfacePath;

const registered = await registeredToolNames();
const generated = `${JSON.stringify(registered, undefined, 2)}\n`;

if (checkOnly) {
  const committed = await readFile(surfacePath, "utf8").catch(() => undefined);
  if (committed === undefined) {
    throw new Error(`MCP tool surface is missing at ${surfacePath}. Run \`pnpm mcp:generate\`.`);
  }
  if (committed !== generated) {
    throw new Error(drift(parseSurface(committed, surfacePath), registered));
  }
  process.stdout.write(`MCP tool surface is up to date: ${String(registered.length)} tools.\n`);
} else {
  await mkdir(path.dirname(surfacePath), { recursive: true });
  await writeFile(surfacePath, generated);
  process.stdout.write(`Wrote ${surfacePath}: ${String(registered.length)} tools\n`);
}

/** Имена инструментов ровно того сервера, который собирает HTTP-вход MCP. */
async function registeredToolNames(): Promise<string[]> {
  // Состав набора не зависит от поведения зависимостей: инструменты обращаются к ним только в вызове.
  const refuse = () => Promise.resolve({ ok: false as const, error: { code: "forbidden" as const } });
  const server = assembleInsideMcpServer({
    accountId: "00000000-0000-4000-8000-000000000000",
    authoring: stubMaterialAuthoring(),
    billing: { execute: refuse },
    communications: { execute: refuse },
    videos: { attachExisting: refuse, initUpload: refuse, reconcile: refuse },
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "inside-mcp-tool-surface", version: "1.0.0" });
  try {
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const { tools } = await client.listTools();
    return tools.map(({ name }) => name).sort();
  } finally {
    await client.close();
    await server.close();
  }
}

/** Расхождение называет инструменты поимённо: догадываться по разнице файлов не нужно. */
function drift(committed: readonly string[], actual: readonly string[]): string {
  const appeared = actual.filter((name) => !committed.includes(name));
  const disappeared = committed.filter((name) => !actual.includes(name));
  const lines = [
    `MCP tool surface drift detected in ${surfacePath}.`,
    ...(appeared.length === 0 ? [] : [`Появились: ${appeared.join(", ")}`]),
    ...(disappeared.length === 0 ? [] : [`Исчезли: ${disappeared.join(", ")}`]),
    ...(appeared.length === 0 && disappeared.length === 0
      ? ["Набор совпал по именам, но файл отличается порядком или форматированием."]
      : []),
    "Run `pnpm mcp:generate` from the repository root and commit the result.",
  ];
  return lines.join("\n");
}

function parseSurface(content: string, source: string): string[] {
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

function readOption(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  const value = index === -1 ? undefined : process.argv[index + 1];
  return value === undefined ? undefined : path.resolve(value);
}
