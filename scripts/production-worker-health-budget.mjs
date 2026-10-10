// @ts-check
import { z } from "zod";

const positiveSafeInteger = z
  .number()
  .int()
  .positive()
  .max(Number.MAX_SAFE_INTEGER);
const healthcheckSchema = z.object({
  Test: z
    .tuple([z.enum(["CMD", "CMD-SHELL"]), z.string().min(1)])
    .rest(z.string()),
  Interval: positiveSafeInteger,
  Timeout: positiveSafeInteger,
  Retries: positiveSafeInteger,
});
const pollIntervalSchema = z.coerce
  .number()
  .int()
  .positive()
  .max(Number.MAX_SAFE_INTEGER);
const nanosecondsPerSecond = 1_000_000_000;
// Retain the smoke's existing two observation attempts beyond the effective probe window.
const observationMarginAttempts = 2;

const worker = process.argv[2] ?? "unknown worker";
try {
  // Docker's JSON representation encodes durations as integer nanoseconds, unlike template display.
  const healthcheck = healthcheckSchema.parse(
    JSON.parse(process.argv[3] ?? ""),
  );
  const pollIntervalSeconds = pollIntervalSchema.parse(process.argv[4]);
  const probeWindowNanoseconds =
    (healthcheck.Interval + healthcheck.Timeout) * healthcheck.Retries;
  if (!Number.isSafeInteger(probeWindowNanoseconds))
    throw new Error("effective probe window exceeds safe integer nanoseconds");
  const attempts =
    Math.ceil(
      probeWindowNanoseconds / nanosecondsPerSecond / pollIntervalSeconds,
    ) + observationMarginAttempts;
  process.stdout.write(String(attempts));
} catch (error) {
  const diagnostic = error instanceof Error ? error.message : String(error);
  console.error(`Invalid Docker healthcheck for ${worker}: ${diagnostic}`);
  process.exitCode = 1;
}
