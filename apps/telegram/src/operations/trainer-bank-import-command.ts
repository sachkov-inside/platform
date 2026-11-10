import type { Database } from "../database/database.js";
import { TrainerBank } from "../modules/trainer/trainer-bank.js";
import type { Clock } from "../shared/clock.js";

export interface TrainerBankImportRun {
  /** `--preview` checks the file and reports what an import would do; `--apply` imports. */
  readonly mode: string | undefined;
  /** The Bank file as text. */
  readonly input: string;
  readonly database: Database;
  readonly clock: Clock;
}

export interface TrainerBankImportOutcome {
  /** 0: the file is correct. 2: the file is rejected. 1: the command was called wrongly. */
  readonly exitCode: 0 | 1 | 2;
  readonly stdout: string;
  readonly stderr: string;
}

export const TRAINER_BANK_IMPORT_USAGE =
  "Use --preview or --apply with the Bank file (JSON) on stdin and DATABASE_URL.\n";

/** The owner's Bank import. The report names questions and reasons, never the Bank's texts. */
export async function runTrainerBankImport(
  run: TrainerBankImportRun,
): Promise<TrainerBankImportOutcome> {
  if (run.mode !== "--preview" && run.mode !== "--apply")
    return { exitCode: 1, stdout: "", stderr: TRAINER_BANK_IMPORT_USAGE };
  let file: unknown;
  try {
    file = JSON.parse(run.input);
  } catch {
    return {
      exitCode: 1,
      stdout: "",
      stderr: "The Bank file is not JSON; nothing was changed.\n",
    };
  }
  const report = await new TrainerBank(run.database, run.clock).import(
    file,
    run.mode === "--apply",
  );
  return {
    exitCode: report.status === "rejected" ? 2 : 0,
    stdout: JSON.stringify(report, null, 2) + "\n",
    stderr: "",
  };
}
