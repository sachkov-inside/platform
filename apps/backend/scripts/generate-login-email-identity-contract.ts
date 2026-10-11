import { readFile, writeFile } from "node:fs/promises";
import { z } from "zod";
import manifest from "@inside/contracts/login-email-identity-v1/manifest.json" with { type: "json" };
import {
  beginLoginEmailIdentitySchema,
  selectLoginEmailCandidateSchema,
  reserveLoginEmailIdentitySchema,
  finalizeLoginEmailIdentitySchema,
  loginEmailIdentityResultSchema,
} from "../src/modules/accounts/facets/login-email-identity/login-email-identity.contract.js";

const destination = new URL(
  "../../../docs/contracts/login-email-identity-v1/schema.json",
  import.meta.url,
);
const output = `${JSON.stringify(
  {
    $schema: "http://json-schema.org/draft-07/schema#",
    $id: manifest.schemaId,
    definitions: Object.fromEntries(
      Object.entries({
        begin: beginLoginEmailIdentitySchema,
        candidate: selectLoginEmailCandidateSchema,
        reservation: reserveLoginEmailIdentitySchema,
        finalization: finalizeLoginEmailIdentitySchema,
        result: loginEmailIdentityResultSchema,
      }).map(([name, codec]) => [
        name,
        z.toJSONSchema(codec, { target: "draft-7" }),
      ]),
    ),
  },
  null,
  2,
)}\n`;

if (process.argv.includes("--check")) {
  if ((await readFile(destination, "utf8")) !== output) {
    throw new Error(
      "Login email identity schema drift; run contracts:login-email:generate",
    );
  }
} else await writeFile(destination, output);
