import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { bindingLookupQuerySchema, beginActivationSchema, activationEvidenceSchema, ownSubscriptionAccessQuerySchema } from "../src/modules/membership-entitlements/index.js";
import { bindingLookupResponseSchema, activationResponseSchema, ownSubscriptionAccessResponseSchema } from "../src/modules/telegram-membership/domain/subscription-activation-wire.js";
const directory = fileURLToPath(new URL("../../../docs/contracts/subscription-activation-v1/", import.meta.url));
const definitions = Object.fromEntries(Object.entries({ begin: beginActivationSchema, evidence: activationEvidenceSchema, activationResponse: activationResponseSchema, ownAccessQuery: ownSubscriptionAccessQuerySchema, ownAccessResponse: ownSubscriptionAccessResponseSchema, bindingQuery: bindingLookupQuerySchema, bindingResponse: bindingLookupResponseSchema }).map(([name, codec]) => [name, z.toJSONSchema(codec, { target: "draft-7", io: "input" })]));
const schema = { $schema: "http://json-schema.org/draft-07/schema#", $id: "https://sachkov-inside.github.io/platform/contracts/subscription-activation-v1.schema.json", definitions };
const output = JSON.stringify(schema, null, 2) + "\n";
await mkdir(directory, { recursive: true });
if (process.argv.includes("--check")) {
  if (await readFile(directory + "schema.json", "utf8") !== output) throw new Error("Subscription activation schema drift; run contracts:generate");
} else await writeFile(directory + "schema.json", output);
