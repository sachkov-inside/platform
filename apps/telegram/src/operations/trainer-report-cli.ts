import { hasText } from "../shared/text.js";
import "../config/load-environment.js";
import { createDatabase } from "../database/create-database.js";
import {
  runTrainerReport,
  TRAINER_REPORT_USAGE,
} from "./trainer-report-command.js";

const [mode, ...rest] = process.argv.slice(2);
if (!hasText(process.env["DATABASE_URL"]) || rest.length > 0) {
  process.stderr.write(TRAINER_REPORT_USAGE);
  process.exitCode = 1;
} else {
  const database = createDatabase(process.env["DATABASE_URL"]);
  try {
    const outcome = await runTrainerReport({ mode, database });
    process.stdout.write(outcome.stdout);
    process.stderr.write(outcome.stderr);
    process.exitCode = outcome.exitCode;
  } catch {
    process.stderr.write("Trainer report failed.\n");
    process.exitCode = 1;
  } finally {
    await database.destroy();
  }
}
