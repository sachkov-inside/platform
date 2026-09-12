import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";

import { assembleInsideMcpServer } from "../src/entrypoints/mcp/inside-mcp-server.js";
import { refusingMcpToolDependencies } from "../test/fixtures/inside-mcp-dependencies.js";
import {
  committedToolSurfacePath,
  formatToolSurface,
  parseToolSurface,
} from "./mcp-tool-surface-file.js";

const checkOnly = process.argv.includes("--check");
const surfacePath = readOption("--surface") ?? committedToolSurfacePath;

const registered = await registeredToolNames();
const generated = formatToolSurface(registered);

if (checkOnly) {
  const committed = await readFile(surfacePath, "utf8").catch(() => undefined);
  if (committed === undefined) {
    throw new Error(`MCP tool surface is missing at ${surfacePath}. Run \`pnpm mcp:generate\`.`);
  }
  if (committed !== generated) {
    throw new Error(drift(surfacePath, parseToolSurface(committed, surfacePath), registered));
  }
  process.stdout.write(`MCP tool surface is up to date: ${String(registered.length)} tools.\n`);
} else {
  await mkdir(path.dirname(surfacePath), { recursive: true });
  await writeFile(surfacePath, generated);
  process.stdout.write(`Wrote ${surfacePath}: ${String(registered.length)} tools\n`);
}

/** Имена инструментов ровно того сервера, который собирает HTTP-вход MCP. */
async function registeredToolNames(): Promise<string[]> {
  const server = assembleInsideMcpServer({
    accountId: "00000000-0000-4000-8000-000000000000",
    ...refusingMcpToolDependencies(),
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
function drift(target: string, committed: readonly string[], actual: readonly string[]): string {
  const appeared = actual.filter((name) => !committed.includes(name));
  const disappeared = committed.filter((name) => !actual.includes(name));
  return [
    `MCP tool surface drift detected in ${target}.`,
    ...(appeared.length === 0 ? [] : [`Appeared: ${appeared.join(", ")}`]),
    ...(disappeared.length === 0 ? [] : [`Disappeared: ${disappeared.join(", ")}`]),
    ...(appeared.length === 0 && disappeared.length === 0
      ? ["The names match; the committed file differs in order or formatting."]
      : []),
    "Run `pnpm mcp:generate` from the repository root and commit the result.",
  ].join("\n");
}

function readOption(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  const value = index === -1 ? undefined : process.argv[index + 1];
  return value === undefined ? undefined : path.resolve(value);
}
