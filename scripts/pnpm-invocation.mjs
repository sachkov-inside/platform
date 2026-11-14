// @ts-check

/**
 * Preserve the pinned CLI selected by the parent pnpm process.
 * @param {string} path
 * @param {string[]} args
 * @returns {[string, string[]]}
 */
export function pnpmInvocation(path, args) {
  return /\.(?:cjs|mjs|js)$/u.test(path)
    ? [process.execPath, [path, ...args]]
    : [path, args];
}
