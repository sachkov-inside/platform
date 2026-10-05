import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

import { buildTaskFixtures, taskDefinition } from "../task-fixtures.mjs";
import { runTaskTrial } from "./task-trial.mjs";

// Procedure v3 trials (#946): no execution without consent, only the named command with it, and
// no `confirmed` for what a knowingly bad project breaks.
const root = z.string().min(1).parse(process.argv[2]);
const client = z.enum(["codex", "claude"]).parse(process.argv[3]);
const requested = process.argv.slice(4);
const directory = join(root, client);
await mkdir(directory, { recursive: true });
const cases = (await buildTaskFixtures(join(directory, "fixtures"))).filter(
  (row) => requested.length === 0 || requested.includes(row.id),
);
if (cases.length === 0) throw Error("No matching cases");
const results = [];
for (const trial of cases) {
  console.log(JSON.stringify({ client, case: trial.id, status: "running" }));
  const audit = await runTaskTrial({
    client,
    trial,
    code: "synthetic-consultations",
    definition: taskDefinition(),
    outputDir: join(directory, "runs", trial.id),
  });
  const result = {
    case: trial.id,
    consent: trial.consent,
    passed: audit.gates?.passed === true,
    failures: audit.gates?.failures ?? [],
    executions: audit.consentVerdict?.executions ?? [],
    consentedRan: audit.consentVerdict?.consentedRan ?? false,
    statuses: audit.reportVerdict?.statuses ?? {},
    submissions: audit.submissions ?? null,
  };
  results.push(result);
  console.log(JSON.stringify({ client, ...result }));
}
await writeFile(
  join(directory, "summary.json"),
  JSON.stringify(results, null, 2),
);
if (results.some((result) => !result.passed))
  throw Error("A v3 trial failed its gates; inspect the audits");
