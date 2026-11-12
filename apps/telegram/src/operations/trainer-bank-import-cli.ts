import { hasText } from "../shared/text.js";
import "../config/load-environment.js";
import { createDatabase } from "../database/create-database.js";
import { systemClock } from "../shared/clock.js";
import {
  runTrainerBankImport,
  TRAINER_BANK_IMPORT_USAGE,
} from "./trainer-bank-import-command.js";

if (!hasText(process.env["DATABASE_URL"]) || process.stdin.isTTY) {
  process.stderr.write(TRAINER_BANK_IMPORT_USAGE);
  process.exitCode = 1;
} else {
  const database = createDatabase(process.env["DATABASE_URL"]);
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
    const outcome = await runTrainerBankImport({
      mode: process.argv[2],
      // Decode once: a pipe chunk may end in the middle of a UTF-8 character.
      input: Buffer.concat(chunks).toString("utf8"),
      database,
      clock: systemClock,
    });
    process.stdout.write(outcome.stdout);
    process.stderr.write(outcome.stderr);
    process.exitCode = outcome.exitCode;
  } catch {
    process.stderr.write("Bank import failed; nothing was changed.\n");
    process.exitCode = 1;
  } finally {
    await database.destroy();
  }
}
