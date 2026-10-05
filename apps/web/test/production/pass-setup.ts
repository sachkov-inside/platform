import { rmSync } from "node:fs";

import { passReportDirectory, readDeployedSha } from "./pass-report";

/**
 * Global setup: неверный вход `deployed-sha` останавливает прогон до первой клетки, а прошлый отчёт
 * не подменяет наблюдения этого прогона.
 */
export default function preparePassReport(): void {
  readDeployedSha();
  rmSync(passReportDirectory, { recursive: true, force: true });
}
