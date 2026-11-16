import { writeFile } from "node:fs/promises";
import type { Reporter, TestModule, SerializedError } from "vitest/node";

export default class PaymentMutationReporter implements Reporter {
  async onTestRunEnd(
    modules: readonly TestModule[],
    unhandledErrors: readonly SerializedError[],
  ) {
    const path = process.env["PAYMENT_MUTATION_ERRORS_PATH"];
    if (path === undefined)
      throw new Error("PAYMENT_MUTATION_ERRORS_PATH is required");
    const tests = modules.flatMap((module) =>
      [...module.children.allTests()].map((test) => {
        const result = test.result();
        return {
          name: test.fullName,
          state: result.state,
          errors: "errors" in result ? result.errors : [],
        };
      }),
    );
    const suiteErrors = [
      ...unhandledErrors,
      ...modules.flatMap((module) => [
        ...module.errors(),
        ...[...module.children.allSuites()].flatMap((suite) => suite.errors()),
      ]),
    ];
    await writeFile(path, JSON.stringify({ tests, suiteErrors }, null, 2));
  }
}
