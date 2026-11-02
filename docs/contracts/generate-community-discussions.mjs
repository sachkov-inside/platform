// @ts-check
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { COMMUNITY_DISCUSSIONS_VERSION, communityDiscussionsRequestSchema, communityDiscussionsSuccessSchema, communityDiscussionsErrorSchema } from "./dist/runtime/community-discussions.js";

const target = new URL("./inside-community-discussions-v1/schema.json", import.meta.url);
const schemas = { request: communityDiscussionsRequestSchema, success: communityDiscussionsSuccessSchema, error: communityDiscussionsErrorSchema };
const document = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: `https://inside.example/contracts/${COMMUNITY_DISCUSSIONS_VERSION.replaceAll(".", "-")}/schema.json`,
  $comment: "Generated structural projection. Runtime Zod codecs additionally enforce the mark status/materialUrls relationship.",
  $defs: Object.fromEntries(Object.entries(schemas).map(([name, schema]) => [name, z.toJSONSchema(schema)])),
};
const generated = `${JSON.stringify(document, null, 2)}\n`;
if (process.argv.includes("--check")) {
  if (await readFile(target, "utf8") !== generated) throw new Error(`Contract drift: ${fileURLToPath(target)}`);
} else await writeFile(target, generated);
