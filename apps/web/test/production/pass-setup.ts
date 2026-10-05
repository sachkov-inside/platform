import { rmSync } from "node:fs";

import { passReportDirectory } from "./pass-report";

/** Global setup: прошлый отчёт не должен подменить наблюдения этого прогона. */
export default function clearPassReport(): void {
  rmSync(passReportDirectory, { recursive: true, force: true });
}
