// Generated from mini-app-identity-proof.mjs with TypeScript declaration emit.
/** @param {string} root */
export declare function createMiniAppIdentityProofContext(root: string): {
  version: string;
  session: string;
  project: string;
  worktree: string;
  directory: string;
  composeFile: string;
  image: string;
  ports: {
    logto: number;
    admin: number;
    postgres: number;
    smtp: number;
    mailpit: number;
    api: number;
    web: number;
    telegram: number;
  };
  issuer: string;
  platformDatabaseUrl: string;
  telegramDatabaseUrl: string;
};
/** @param {string} path
 * @param {string} root */
export declare function readMiniAppIdentityProofContext(
  path: string,
  root: string,
): {
  version: string;
  session: string;
  project: string;
  worktree: string;
  directory: string;
  composeFile: string;
  image: string;
  ports: {
    logto: number;
    admin: number;
    postgres: number;
    smtp: number;
    mailpit: number;
    api: number;
    web: number;
    telegram: number;
  };
  issuer: string;
  platformDatabaseUrl: string;
  telegramDatabaseUrl: string;
};
/** @param {ReturnType<typeof createMiniAppIdentityProofContext>} context */
export declare function miniAppIdentityProofComposeArguments(
  context: ReturnType<typeof createMiniAppIdentityProofContext>,
): string[];
/** @param {ReturnType<typeof createMiniAppIdentityProofContext>} context */
export declare function prepareMiniAppIdentityProofContext(
  context: ReturnType<typeof createMiniAppIdentityProofContext>,
): string;
export type ProofInventory = (
  file: string,
  args: string[],
  options: {
    encoding: "utf8";
    timeout: number;
  },
) => string;
/** @typedef {(file: string, args: string[], options: { encoding: "utf8", timeout: number }) => string} ProofInventory
 * @param {ReturnType<typeof createMiniAppIdentityProofContext>} context
 * @param {ProofInventory} [run] */
export declare function assertMiniAppIdentityProofAvailable(
  context: ReturnType<typeof createMiniAppIdentityProofContext>,
  run?: ProofInventory,
): void;
