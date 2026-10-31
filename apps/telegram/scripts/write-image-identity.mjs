// @ts-check
import { writeFileSync } from "node:fs";
import { productionRuntimeIdentitySchema } from "@inside/runtime-identity";

const [release, sourceSha, outputPath] = process.argv.slice(2);
// Ordinary local builds have no captured release ordinal.
if (release !== undefined && release !== "") {
  const identity = productionRuntimeIdentitySchema.parse({
    release,
    sourceSha,
  });
  if (outputPath === undefined || outputPath.length === 0) {
    throw new Error("Release identity output path is required");
  }
  writeFileSync(outputPath, `${JSON.stringify(identity)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o444,
  });
}
