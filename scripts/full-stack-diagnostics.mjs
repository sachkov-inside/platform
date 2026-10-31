// @ts-check
import { StringDecoder } from "node:string_decoder";
import { z } from "zod";

// A reporter emits this before list/html reporters format a failure. No test titles or errors
// travel over this channel: they can contain response data or credential-bearing call logs.
export const firstFailureMarker = "[fullstack-test-failure]";

/**
 * Redact complete lines so secrets and header names split across pipe chunks cannot escape.
 * @param {(line: string) => void} write
 * @param {string[]} [secrets]
 */
export function createDiagnosticStream(write, secrets = []) {
  const decoder = new StringDecoder("utf8");
  let pending = "";
  let oversized = false;
  /** @param {string} line */
  function publish(line) {
    // eslint-disable-next-line no-control-regex -- Strip terminal color codes before matching credential headers.
    let safe = line.replace(/\u001b\[[0-9;]*m/gu, "");
    safe = safe.replace(
      /((?:^|\s)(?:cookie|set-cookie|authorization|proxy-authorization):)[^\r\n]*/giu,
      "$1 <REDACTED>",
    );
    for (const secret of secrets) {
      if (secret.length > 0) safe = safe.replaceAll(secret, "<REDACTED>");
    }
    write(safe);
  }
  return {
    /** @param {Buffer} chunk */
    write(chunk) {
      for (const part of decoder.write(chunk).split(/(?<=\n)/u)) {
        if (!oversized) pending += part;
        if (pending.length > 40_000) {
          pending = "";
          oversized = true;
        }
        if (part.endsWith("\n")) {
          publish(
            oversized ? "<oversized diagnostic line omitted>\n" : pending,
          );
          pending = "";
          oversized = false;
        }
      }
    },
    end() {
      pending += decoder.end();
      if (oversized) publish("<oversized diagnostic line omitted>\n");
      else if (pending.length > 0) publish(pending);
      pending = "";
      oversized = false;
    },
  };
}

/**
 * @typedef {{
 *   name: string;
 *   child: import("node:child_process").ChildProcess;
 *   output: string[];
 *   spawnedAt: string;
 *   exitedAt: string | null;
 * }} DiagnosticProcessEntry
 */

/**
 * Observe the owned supervisor's lifetime, not application readiness or a worker's exit.
 * @param {string} name
 * @param {import("node:child_process").ChildProcess} child
 * @param {string[]} output
 * @returns {DiagnosticProcessEntry}
 */
export function trackDiagnosticProcess(name, child, output) {
  /** @type {DiagnosticProcessEntry} */
  const entry = {
    name,
    child,
    output,
    // deterministic-test-allow wall-clock: real supervisor spawn observation for request-trace correlation.
    spawnedAt: new Date().toISOString(),
    exitedAt: null,
  };
  child.once("exit", () => {
    // deterministic-test-allow wall-clock: real supervisor exit observation for request-trace correlation.
    entry.exitedAt = new Date().toISOString();
  });
  return entry;
}

const ciIdentifier = z
  .string()
  .max(20)
  .regex(/^[1-9][0-9]*$/u);
const correlationSchema = z.object({
  GITHUB_SHA: z.hash("sha1").nullable().catch(null),
  GITHUB_RUN_ID: ciIdentifier.nullable().catch(null),
  GITHUB_RUN_ATTEMPT: ciIdentifier.nullable().catch(null),
});

/**
 * @param {() => { name: string; child: { pid?: number | undefined; exitCode: number | null; signalCode: string | null }; output: string[]; spawnedAt: string; exitedAt: string | null }[]} entries
 * @param {(line: string) => void} write
 * @param {Record<string, unknown>} [environment]
 */
export function firstFailureSnapshot(
  entries,
  write,
  environment = process.env,
) {
  const correlation = correlationSchema.parse(environment);
  let captured = false;
  /** @param {string} line */
  return (line) => {
    if (captured || !line.includes(firstFailureMarker)) return;
    captured = true;
    write(
      `${JSON.stringify({
        kind: "fullstack-first-failure",
        // deterministic-test-allow wall-clock: correlates the real reporter signal with CI request traces.
        capturedAt: new Date().toISOString(),
        sourceSha: correlation.GITHUB_SHA,
        runId: correlation.GITHUB_RUN_ID,
        runAttempt: correlation.GITHUB_RUN_ATTEMPT,
        processes: entries().map(
          ({ name, child, output, spawnedAt, exitedAt }) => ({
            name,
            pid: child.pid ?? null,
            exitCode: child.exitCode,
            signalCode: child.signalCode,
            spawnedAt,
            exitedAt,
            output: output.join(""),
          }),
        ),
      })}\n`,
    );
  };
}
