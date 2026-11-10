import type { Database } from "../database/database.js";
import { TrainerReports } from "../modules/trainer/trainer-reports.js";

export interface TrainerReportRun {
  /** `--questions`: answers per question. `--usage`: openings and answerers per Moscow day. */
  readonly mode: string | undefined;
  readonly database: Database;
}

export interface TrainerReportOutcome {
  /** 0: the report is printed. 1: the command was called wrongly. */
  readonly exitCode: 0 | 1;
  readonly stdout: string;
  readonly stderr: string;
}

export const TRAINER_REPORT_USAGE =
  "Use --questions or --usage with DATABASE_URL.\n";

/** The author's Trainer reports: one JSON line per question or per day, no names or identifiers. */
export async function runTrainerReport(
  run: TrainerReportRun,
): Promise<TrainerReportOutcome> {
  if (run.mode !== "--questions" && run.mode !== "--usage")
    return { exitCode: 1, stdout: "", stderr: TRAINER_REPORT_USAGE };
  const reports = new TrainerReports(run.database);
  const lines: readonly object[] =
    run.mode === "--questions"
      ? await reports.questions()
      : await reports.usage();
  return {
    exitCode: 0,
    stdout: lines.map((line) => JSON.stringify(line) + "\n").join(""),
    stderr: "",
  };
}
