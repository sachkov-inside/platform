// @ts-check
import { firstFailureMarker } from "../../../../scripts/full-stack-diagnostics.mjs";

/**
 * Notify the owning runner while the failure's process output is still retained.
 */
export default class FullStackFailureReporter {
  /**
   * @param {import("@playwright/test/reporter").TestCase} _test
   * @param {import("@playwright/test/reporter").TestResult} result
   */
  onTestEnd(_test, result) {
    if (result.status !== "passed" && result.status !== "skipped") {
      process.stdout.write(`${firstFailureMarker}\n`);
    }
  }
}
