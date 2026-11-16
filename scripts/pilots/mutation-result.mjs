// @ts-check
/** @param {unknown} error @returns {boolean} */
function isAssertion(error) {
  if (typeof error !== "object" || error === null) return false;
  if ("name" in error && error.name === "AssertionError")
    return !("cause" in error) || isAssertion(error.cause);
  return (
    "message" in error &&
    typeof error.message === "string" &&
    error.message.startsWith("PROPERTY_SEED=") &&
    "cause" in error &&
    isAssertion(error.cause)
  );
}

/**
 * A complete seven-case probe counts only assertion failures, including sequence causes (#2251).
 * @param {{exitCode: number|null, tests: Array<{state:string, errors:unknown[]}>, suiteErrors:unknown[]}} result
 * @returns {"survived"|"killed"|"invalid"}
 */
export function classifyMutationResult({ exitCode, tests, suiteErrors }) {
  if (
    tests.length !== 7 ||
    suiteErrors.length > 0 ||
    (exitCode !== 0 && exitCode !== 1)
  )
    return "invalid";
  if (tests.some((test) => test.state !== "passed" && test.state !== "failed"))
    return "invalid";
  const failed = tests.filter((test) => test.state === "failed");
  if (exitCode === 0 && failed.length === 0) return "survived";
  if (
    exitCode === 1 &&
    failed.length > 0 &&
    failed.every(
      (test) => test.errors.length > 0 && test.errors.every(isAssertion),
    )
  )
    return "killed";
  return "invalid";
}
