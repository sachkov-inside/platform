import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { parsePlatformConfig } from "../src/config/platform-config.js";
import {
  createApiApplication,
  createApiOpenApiDocument,
} from "../src/entrypoints/api/create-api-application.js";

const outputPath = path.resolve("openapi/platform-api.json");
const checkOnly = process.argv.includes("--check");

const app = await createApiApplication(parsePlatformConfig({ NODE_ENV: "test" }), {
  abortOnError: false,
  logger: false,
});

try {
  const generated = `${JSON.stringify(
    sortObjectKeys(createApiOpenApiDocument(app)),
    undefined,
    2,
  )}\n`;

  if (checkOnly) {
    const committed = await readFile(outputPath, "utf8").catch(() => undefined);
    if (committed !== generated) {
      throw new Error(
        "OpenAPI schema drift detected. Run `pnpm api:generate` from the repository root.",
      );
    }
    process.stdout.write("OpenAPI schema is up to date.\n");
  } else {
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, generated);
    process.stdout.write(`Wrote ${outputPath}\n`);
  }
} finally {
  await app.close();
}

function sortObjectKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortObjectKeys);
  }
  if (typeof value !== "object" || value === null) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, sortObjectKeys(entry)]),
  );
}
