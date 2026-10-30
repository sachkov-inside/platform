import type { SpawnSyncOptionsWithStringEncoding } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { jsonRecord } from "./json.js";
import { runOwnedCommandSync } from "./owned-command.js";

type Boundary = "payload" | "gateway" | "installer" | "ssh-keygen";
interface CommandTrace {
  boundary: Boundary;
  elapsedMs: number;
  status: number | null;
  signal: string | null;
  error: string | null;
  operationPhase: string;
  lifecycle: Record<string, unknown>[];
}

const phases = new Set([
  "preflight",
  "pull",
  "stage",
  "stop",
  "migrate",
  "start",
  "readiness",
  "routes",
  "state",
  "complete",
]);
const lifecyclePhases = new Set([
  "supervisor-start",
  "command-start",
  "command-exit",
  "cleanup-start",
  "cleanup-complete",
]);

/** Retain only allowlisted facts outside the disposable gateway host fixture. */
export class GatewayDiagnostics {
  readonly reportPath: string;
  private readonly commands: CommandTrace[] = [];

  constructor(private readonly directory: string) {
    mkdirSync(directory, { recursive: true });
    this.reportPath = path.join(directory, "report.json");
  }

  run(
    boundary: Boundary,
    command: string,
    args: readonly string[],
    options: SpawnSyncOptionsWithStringEncoding,
    operationFile?: string,
  ): ReturnType<typeof runOwnedCommandSync> {
    const tracePath = path.join(
      this.directory,
      `${this.commands.length}.jsonl`,
    );
    const previousOperation = readOptional(operationFile);
    const started = performance.now();
    // Persist before blocking: a killed worker still leaves the active command and its trace.
    this.persist({ boundary, lifecycleFile: path.basename(tracePath) });
    const result = runOwnedCommandSync(command, args, {
      ...options,
      env: {
        ...(options.env ?? process.env),
        INSIDE_OWNED_PROCESS_TRACE: tracePath,
      },
    });
    const operation = readOptional(operationFile);
    let operationPhase = "not-written";
    if (operation !== undefined && operation !== previousOperation) {
      try {
        const phase = jsonRecord(operation)["phase"];
        operationPhase =
          typeof phase === "string" && phases.has(phase)
            ? phase
            : "unavailable";
      } catch {
        operationPhase = "unavailable";
      }
    }
    this.commands.push({
      boundary,
      elapsedMs: Math.round((performance.now() - started) * 1000) / 1000,
      status: result.status,
      signal: result.signal,
      error:
        result.error &&
        "code" in result.error &&
        typeof result.error.code === "string"
          ? result.error.code
          : null,
      operationPhase,
      lifecycle: lifecycleRows(tracePath),
    });
    this.persist(null);
    return result;
  }

  private persist(
    active: { boundary: Boundary; lifecycleFile: string } | null,
  ): void {
    writeFileSync(
      this.reportPath,
      `${JSON.stringify({ schemaVersion: 1, commands: this.commands, active }, null, 2)}\n`,
    );
  }
}

function readOptional(file: string | undefined): string | undefined {
  if (file === undefined) return undefined;
  try {
    return readFileSync(file, "utf8");
  } catch {
    return undefined;
  }
}

function lifecycleRows(file: string): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];
  for (const line of (readOptional(file) ?? "")
    .split("\n")
    .filter(Boolean)
    .slice(0, 5)) {
    try {
      const row = jsonRecord(line);
      if (
        typeof row["phase"] !== "string" ||
        !lifecyclePhases.has(row["phase"]) ||
        typeof row["elapsedMs"] !== "number" ||
        !Number.isFinite(row["elapsedMs"])
      )
        continue;
      const safe: Record<string, unknown> = {
        phase: row["phase"],
        elapsedMs: row["elapsedMs"],
      };
      if (typeof row["status"] === "number") safe["status"] = row["status"];
      rows.push(safe);
    } catch {
      // A worker interrupted during one JSON line still retains earlier phase facts.
    }
  }
  return rows;
}
