import { randomUUID } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { z } from "zod";

import { registeredLogSecrets } from "./logto";
import {
  evaluatePass,
  renderPassMarkdown,
  type BlockedPassRequest,
  type PassObservation,
  type PassProblem,
  type PassReport,
} from "./pass-cells";
import { passCells } from "./pass-config";
import { redactPassText } from "./pass-redaction";

/** Каталог отчёта прохода; job загружает его в artifact. */
export const passReportDirectory = resolve(
  process.env["PRODUCTION_ACCESS_REPORT_DIR"] ?? "production-access-report",
);
const observationsDirectory = join(passReportDirectory, "observations");
const blockedDirectory = join(passReportDirectory, "blocked");
const problemsDirectory = join(passReportDirectory, "problems");
const problemSchema = z.object({ cellId: z.string(), problem: z.string() });
/** Причина «не проверено» в отчёте — одна строка, не стек. */
const problemLength = 240;
const observationSchema = z.object({
  cellId: z.string(),
  observed: z.enum(["allowed", "denied"]),
  note: z.string().optional(),
});
const blockedSchema = z.array(
  z.object({ method: z.string(), target: z.string(), reason: z.string() }),
);

/**
 * Наблюдение пишет тест клетки. Заметка проходит очистку: в отчёт не попадают токены, cookies и
 * email.
 */
export function recordObservation(observation: PassObservation): void {
  mkdirSync(observationsDirectory, { recursive: true });
  const { note, ...rest } = observation;
  writeFileSync(
    join(
      observationsDirectory,
      `${encodeURIComponent(observation.cellId)}.json`,
    ),
    `${JSON.stringify(
      observationSchema.parse(
        note === undefined
          ? rest
          : { ...rest, note: redactPassText(note, registeredLogSecrets()) },
      ),
    )}\n`,
  );
}

/** Причина, по которой тест не наблюдал клетку; без неё «не проверено» пришлось бы искать в логе. */
export function recordProblem(cellId: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  const problem: PassProblem = {
    cellId,
    problem: redactPassText(
      (message.split("\n")[0] ?? "").slice(0, problemLength),
      registeredLogSecrets(),
    ),
  };
  mkdirSync(problemsDirectory, { recursive: true });
  writeFileSync(
    join(problemsDirectory, `${encodeURIComponent(cellId)}.json`),
    `${JSON.stringify(problemSchema.parse(problem))}\n`,
  );
}

/** Запросы, которые allowlist отклонил в браузере; пишет их тест после своих страниц. */
export function recordBlockedRequests(
  requests: readonly BlockedPassRequest[],
): void {
  if (requests.length === 0) return;
  mkdirSync(blockedDirectory, { recursive: true });
  writeFileSync(
    join(blockedDirectory, `${randomUUID()}.json`),
    `${JSON.stringify(requests)}\n`,
  );
}

function readDirectory<T>(directory: string, parse: (text: string) => T): T[] {
  let names: string[];
  try {
    names = readdirSync(directory);
  } catch {
    return [];
  }
  return names.map((name) =>
    parse(readFileSync(join(directory, name), "utf8")),
  );
}

function readBlockedRequests(): BlockedPassRequest[] {
  const unique = new Map<string, BlockedPassRequest>();
  for (const requests of readDirectory(blockedDirectory, (text) =>
    blockedSchema.parse(JSON.parse(text)),
  ))
    for (const request of requests)
      unique.set(`${request.method} ${request.target}`, request);
  return [...unique.values()].sort((a, b) =>
    `${a.target} ${a.method}`.localeCompare(`${b.target} ${b.method}`),
  );
}

/**
 * Снаружи production свой SHA не показывает: `/_health/*` закрыт на edge. SHA передаёт тот, кто
 * запускает проход: вход `deployed-sha` workflow, а `deploy.yml` — SHA выпуска, который он развернул.
 */
export function readDeployedSha(): string | null {
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
    observations: readDirectory(observationsDirectory, (text) =>
      observationSchema.parse(JSON.parse(text)),
    ),
    problems: readDirectory(problemsDirectory, (text) =>
      problemSchema.parse(JSON.parse(text)),
    ),
    deployedSha: readDeployedSha(),
    deployedShaRequired:
      process.env["PRODUCTION_ACCESS_REQUIRE_DEPLOYED_SHA"] === "true",
    blockedRequests: readBlockedRequests(),
  });
  // Teardown идёт в своём процессе: токены прогона он не знает, поэтому скрывает секреты окружения и
  // всё, что похоже на токен, cookie или email.
  const secrets = [
    process.env["PRODUCTION_ACCESS_MAILBOX"],
    process.env["PRODUCTION_ACCESS_LOGTO_APP_SECRET"],
  ].filter((value): value is string => value !== undefined && value !== "");
  const json = redactPassText(`${JSON.stringify(report, null, 2)}\n`, secrets);
  const markdown = redactPassText(renderPassMarkdown(report), secrets);
  mkdirSync(passReportDirectory, { recursive: true });
  writeFileSync(join(passReportDirectory, "report.json"), json);
  writeFileSync(join(passReportDirectory, "report.md"), markdown);
  process.stdout.write(`\n${markdown}`);
  if (report.verdict !== "green") {
    throw new Error("Production access pass is red: see report.md");
  }
}
