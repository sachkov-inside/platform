// @ts-check
// A delivery refusal carries a stable code, so a calling tool can branch on it without parsing text.

/**
 * @param {string} code
 * @param {string} message
 * @param {unknown} [cause]
 */
export function refusal(code, message, cause) {
  return Object.assign(
    new Error(message, cause === undefined ? undefined : { cause }),
    { code },
  );
}

/**
 * The stable code of a refusal, or `delivery_failed` for any other error.
 *
 * @param {unknown} error
 */
export function refusalCode(error) {
  return error instanceof Error &&
    "code" in error &&
    typeof error.code === "string" &&
    /^[a-z][a-z0-9_]*$/u.test(error.code)
    ? error.code
    : "delivery_failed";
}
