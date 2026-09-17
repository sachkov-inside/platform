// Lists the products of a local environment (#671). The stand needs its authoring gateway, which this
// command reuses or starts for the duration of the listing; the editor runtime serves the API itself.
import { parseArgs } from "node:util";

import { printProducts } from "../tools/authoring/products.mjs";
import { resolveLocalTarget } from "../tools/authoring/target.mjs";
import { standIdentity, withStandGateway } from "./stand-gateway-session.mjs";

const { values } = parseArgs({ options: {
  target: { type: "string", default: "stand" },
  "owner-email": { type: "string" },
  json: { type: "boolean", default: false },
} });
if (values.target === "stand") {
  const { email } = await standIdentity(values["owner-email"]);
  await withStandGateway(email, (origin) => printProducts(origin, { json: values.json }));
} else {
  await printProducts(resolveLocalTarget(values.target), { json: values.json });
}
