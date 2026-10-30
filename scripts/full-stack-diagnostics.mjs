// @ts-check
import { StringDecoder } from "node:string_decoder";

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
 * @param {() => { name: string; child: { pid?: number | undefined; exitCode: number | null; signalCode: string | null }; output: string[] }[]} entries
 * @param {(line: string) => void} write
 */
export function firstFailureSnapshot(entries, write) {
  let captured = false;
  /** @param {string} line */
  return (line) => {
    if (captured || !line.includes(firstFailureMarker)) return;
    captured = true;
    write(
      `${JSON.stringify({
        kind: "fullstack-first-failure",
        processes: entries().map(({ name, child, output }) => ({
          name,
          pid: child.pid ?? null,
          exitCode: child.exitCode,
          signalCode: child.signalCode,
          output: output.join(""),
        })),
      })}\n`,
    );
  };
}
