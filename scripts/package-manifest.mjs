// @ts-check
import { readFileSync } from "node:fs";
import { z } from "zod";

const packageMapSchema = z.record(z.string(), z.string()).default({});

/** The package.json fields repository scripts read; every other field passes through. */
export const packageManifestSchema = z
  .object({
    packageManager: z.string().optional(),
    scripts: packageMapSchema,
    dependencies: packageMapSchema,
    devDependencies: packageMapSchema,
    files: z.array(z.string()).optional(),
  })
  .passthrough();

/**
 * @param {string} path
 * @returns {z.infer<typeof packageManifestSchema>}
 */
export function readPackageManifest(path) {
  return packageManifestSchema.parse(JSON.parse(readFileSync(path, "utf8")));
}
