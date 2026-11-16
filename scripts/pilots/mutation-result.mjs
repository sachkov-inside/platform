// @ts-check
/**
 * Count only completed seven-case payment probes; infrastructure failures are not mutation kills (#2251).
 * @param {{exitCode: number|null, passed: number, failed: number, log: string}} result
 * @returns {"survived"|"killed"|"invalid"}
 */
export function classifyMutationResult({ exitCode, passed, failed, log }) {
  if (passed + failed !== 7 || exitCode === null) return "invalid";
  if (exitCode === 0 && passed === 7) return "survived";
  if (
    exitCode !== 0 &&
    failed > 0 &&
    log.includes("Caused by: AssertionError") &&
    !/Test timed out|Hook timed out|Unhandled Error/u.test(log)
  )
    return "killed";
  return "invalid";
}
