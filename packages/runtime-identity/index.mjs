// @ts-check
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { z } from "zod";

export const ordinalReleaseSchema = z
  .string()
  .regex(/^v[1-9][0-9]*$/, "release version must be vN with a positive ordinal")
  .refine(
    (value) => Number.isSafeInteger(Number(value.slice(1))),
    "release ordinal exceeds the safe integer range",
  );
export const sourceShaSchema = z.hex().length(40).lowercase();
export const sha256IdentitySchema = z.intersection(
  z.templateLiteral(["sha256:", z.hash("sha256")]),
  z.string().lowercase(),
);
export const productionRuntimeIdentitySchema = z
  .strictObject({
    release: ordinalReleaseSchema,
    sourceSha: sourceShaSchema,
  })
  .readonly();
const localRuntimeIdentitySchema = z
  .strictObject({
    release: z.enum(["development", "test"]),
    sourceSha: z.literal("0".repeat(40)),
  })
  .readonly();
export const runtimeIdentitySchema = z.union([
  productionRuntimeIdentitySchema,
  localRuntimeIdentitySchema,
]);

/**
 * @param {Parameters<typeof import("./index.mjs").resolveRuntimeIdentity>[0]} input
 * @returns {import("./index.mjs").RuntimeIdentity}
 */
export function resolveRuntimeIdentity(input) {
  const localImageIdentity =
    input.mode === "development" &&
    input.environment["PLATFORM_LOCAL_RELEASE_IDENTITY"] === "image";
  if (input.mode !== "production" && !localImageIdentity) {
    return Object.freeze({
      release: input.mode,
      sourceSha: "0".repeat(40),
    });
  }

  const runtime = parseProductionIdentity(
    {
      release: required(
        input.environment,
        "PLATFORM_RELEASE_VERSION",
        input.mode,
      ),
      sourceSha: required(input.environment, "PLATFORM_SOURCE_SHA", input.mode),
    },
    "Runtime",
  );
  const embedded = parseProductionIdentity(
    input.embeddedIdentity ?? readEmbeddedIdentity(),
    "Immutable image",
  );
  if (
    runtime.release !== embedded.release ||
    runtime.sourceSha !== embedded.sourceSha
  ) {
    throw new Error(
      "Runtime release identity does not match the immutable image identity",
    );
  }
  return Object.freeze(runtime);
}

/** @returns {unknown} */
function readEmbeddedIdentity() {
  const path = resolve(process.cwd(), "release-identity.json");
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (cause) {
    throw new Error(`Could not read immutable image identity at ${path}`, {
      cause,
    });
  }
}

/**
 * @param {unknown} value
 * @param {string} label
 */
function parseProductionIdentity(value, label) {
  const parsed = productionRuntimeIdentitySchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`${label} release identity is invalid`);
  }
  return parsed.data;
}

/**
 * @param {Readonly<Record<string, string | undefined>>} environment
 * @param {string} name
 * @param {import("./index.mjs").RuntimeMode} mode
 */
function required(environment, name, mode) {
  const value = environment[name]?.trim();
  if (value === undefined || value.length === 0) {
    throw new Error(
      `${name} is required ${mode === "production" ? "in production mode" : "for local image identity"}`,
    );
  }
  return value;
}
