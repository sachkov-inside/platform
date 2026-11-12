import type { Database } from "../database/database.js";
import { AiModelsReports } from "../modules/ai-models/ai-models-reports.js";
import type { Clock } from "../shared/clock.js";

export interface AiModelsReportRun {
  /** `--usage`: openings and people per Moscow day. `--cards`: opened cards per model. */
  readonly mode: string | undefined;
  readonly database: Database;
  readonly clock: Clock;
}

export interface AiModelsReportOutcome {
  /** 0: the report is printed. 1: the command was called wrongly. */
  readonly exitCode: 0 | 1;
  readonly stdout: string;
  readonly stderr: string;
}

export const AI_MODELS_REPORT_USAGE =
  "Use --usage or --cards with DATABASE_URL.\n";

/** The author's ИИ-модели reports: one JSON line per day or per model, no names or identifiers. */
export async function runAiModelsReport(
  run: AiModelsReportRun,
): Promise<AiModelsReportOutcome> {
  if (run.mode !== "--usage" && run.mode !== "--cards")
    return { exitCode: 1, stdout: "", stderr: AI_MODELS_REPORT_USAGE };
  const reports = new AiModelsReports(run.database);
  const lines: readonly object[] =
    run.mode === "--usage"
      ? await reports.usage()
      : await reports.cards(run.clock.now());
  return {
    exitCode: 0,
    stdout: lines.map((line) => JSON.stringify(line) + "\n").join(""),
    stderr: "",
  };
}
