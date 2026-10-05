import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { z } from "zod";

import {
  evaluatePass,
  renderPassMarkdown,
  type PassObservation,
  type PassReport,
} from "./pass-cells";
import { passCells } from "./pass-config";

/** Каталог отчёта прохода; job загружает его в artifact. */
export const passReportDirectory = resolve(
  process.env["PRODUCTION_ACCESS_REPORT_DIR"] ?? "production-access-report",
);
const observationsDirectory = join(passReportDirectory, "observations");
const observationSchema = z.object({
  cellId: z.string(),
  observed: z.enum(["allowed", "denied"]),
});

/** Наблюдение пишет тест клетки. В нём нет токенов, cookies и персональных данных. */
export function recordObservation(observation: PassObservation): void {
  mkdirSync(observationsDirectory, { recursive: true });
  writeFileSync(
    join(
      observationsDirectory,
      `${encodeURIComponent(observation.cellId)}.json`,
    ),
    `${JSON.stringify(observationSchema.parse(observation))}\n`,
  );
}

function readObservations(): PassObservation[] {
  let names: string[];
  try {
    names = readdirSync(observationsDirectory);
  } catch {
    return [];
  }
  return names.map((name) =>
    observationSchema.parse(
      JSON.parse(readFileSync(join(observationsDirectory, name), "utf8")),
    ),
  );
}

/**
 * Снаружи production свой SHA не показывает: `/_health/*` закрыт на edge. SHA передаёт тот, кто
 * запускает проход: вход `deployed-sha` workflow, а из `deploy.yml` — выпуск, который он развернул
 * (#906). Без входа отчёт пишет «не передан».
 */
function readDeployedSha(): string | null {
  const value = process.env["PRODUCTION_ACCESS_DEPLOYED_SHA"];
  if (value === undefined || value === "") return null;
  return z
    .string()
    .regex(
      /^[0-9a-f]{40}$/u,
      "PRODUCTION_ACCESS_DEPLOYED_SHA must be a commit SHA",
    )
    .parse(value);
}

/** Global teardown: собирает отчёт и роняет прогон, если итог красный. */
export default function writePassReport(): void {
  const report: PassReport = evaluatePass({
    cells: passCells,
    observations: readObservations(),
    deployedSha: readDeployedSha(),
  });
  mkdirSync(passReportDirectory, { recursive: true });
  writeFileSync(
    join(passReportDirectory, "report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  const markdown = renderPassMarkdown(report);
  writeFileSync(join(passReportDirectory, "report.md"), markdown);
  process.stdout.write(`\n${markdown}`);
  if (report.verdict !== "green") {
    throw new Error("Production access pass is red: see report.md");
  }
}
