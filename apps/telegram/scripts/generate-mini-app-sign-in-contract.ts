import { readFile, writeFile } from "node:fs/promises";
import { z } from "zod";
import manifest from "@inside/contracts/mini-app-sign-in-v1/manifest.json" with { type: "json" };
import {
  miniAppApprovalSchema,
  miniAppRegistrationSchema,
} from "../src/modules/bot-sign-in/mini-app-sign-in.contract.js";

const destination = new URL(
  "../../../docs/contracts/mini-app-sign-in-v1/schema.json",
  import.meta.url,
);
const source = `${JSON.stringify(
  {
    $schema: "http://json-schema.org/draft-07/schema#",
    $id: manifest.schemaId,
    definitions: {
      registration: z.toJSONSchema(miniAppRegistrationSchema, {
        target: "draft-7",
      }),
      approval: z.toJSONSchema(miniAppApprovalSchema, { target: "draft-7" }),
    },
  },
  null,
  2,
)}\n`;

if (process.argv.includes("--check")) {
  if ((await readFile(destination, "utf8")) !== source) {
    throw new Error(
      "Mini App wire schema drift; run contracts:mini-app:generate",
    );
  }
} else {
  await writeFile(destination, source);
}
