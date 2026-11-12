import type { Database } from "../database/database.js";
import { AiModelsReferences } from "../modules/ai-models/ai-models-reference.js";
import type { Clock } from "../shared/clock.js";

export interface AiModelsReferenceImportRun {
  /** `--preview` checks the file and reports what an import would do; `--apply` imports. */
  readonly mode: string | undefined;
  /** The Справочник file as text. */
  readonly input: string;
  readonly database: Database;
  readonly clock: Clock;
}

export interface AiModelsReferenceImportOutcome {
  /** 0: the file is correct. 2: the file is rejected. 1: the command was called wrongly. */
  readonly exitCode: 0 | 1 | 2;
  readonly stdout: string;
  readonly stderr: string;
}

export const AI_MODELS_REFERENCE_IMPORT_USAGE =
  "Use --preview or --apply with the Справочник file (JSON) on stdin and DATABASE_URL.\n";

/** The owner's Справочник import. The report names codes and reasons, never the file's texts. */
export async function runAiModelsReferenceImport(
  run: AiModelsReferenceImportRun,
): Promise<AiModelsReferenceImportOutcome> {
  if (run.mode !== "--preview" && run.mode !== "--apply")
    return {
      exitCode: 1,
      stdout: "",
      stderr: AI_MODELS_REFERENCE_IMPORT_USAGE,
    };
  let file: unknown;
  try {
    file = JSON.parse(run.input);
  } catch {
    return {
      exitCode: 1,
      stdout: "",
      stderr: "The Справочник file is not JSON; nothing was changed.\n",
    };
  }
  const report = await new AiModelsReferences(run.database, run.clock).import(
    file,
    run.mode === "--apply",
  );
  return {
    exitCode: report.status === "rejected" ? 2 : 0,
    stdout: JSON.stringify(report, null, 2) + "\n",
    stderr: "",
  };
}
