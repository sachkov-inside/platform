// @ts-check
import { execFileSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

/** @param {string} root */
export function createMiniAppIdentityProofContext(root) {
  const worktree = realpathSync(root);
  const directory = resolve(worktree, ".reports/461/runtime");
  assertNoSymbolicLinks(worktree, directory);
  for (const path of [
    "compose.env",
    "platform.env",
    "tls",
    "tls/certificate.pem",
    "tls/private-key.pem",
    "tls/ca.pem",
    "tls/ca-key.pem",
    "tls/leaf.pem",
  ])
    assertNoSymbolicLinks(worktree, resolve(directory, path));
  return {
    version: "inside.461-proof.v1",
    session: "platform-461-codex-20261010-identity",
    project: "inside-platform-461-codex-20261010-identity",
    worktree,
    directory,
    composeFile: resolve(worktree, "infra/identity/logto/compose.461.yaml"),
    image: "inside/logto-proof:1.44.0-inside.8-461-20261010",
    ports: {
      logto: 14601,
      admin: 14602,
      postgres: 14603,
      smtp: 14604,
      mailpit: 14605,
      api: 14606,
      web: 14607,
      telegram: 14608,
    },
    issuer: "https://identity.inside.localhost:14601/oidc",
    platformDatabaseUrl:
      "postgresql://inside461:inside461-synthetic@127.0.0.1:14603/inside461",
    telegramDatabaseUrl:
      "postgresql://inside461:inside461-synthetic@127.0.0.1:14603/telegram461",
  };
}

/** @param {string} path
 * @param {string} root */
export function readMiniAppIdentityProofContext(path, root) {
  const expected = createMiniAppIdentityProofContext(root);
  if (resolve(path) !== resolve(expected.directory, "context.json"))
    throw new Error("#461 proof context must belong to this worktree");
  assertNoSymbolicLinks(expected.worktree, path);
  const received = /** @type {unknown} */ (
    JSON.parse(readFileSync(path, "utf8"))
  );
  if (!isDeepStrictEqual(received, expected))
    throw new Error("#461 proof context does not match its isolated namespace");
  return expected;
}

/** @param {ReturnType<typeof createMiniAppIdentityProofContext>} context */
export function miniAppIdentityProofComposeArguments(context) {
  return [
    "compose",
    "--project-name",
    context.project,
    "--env-file",
    resolve(context.directory, "compose.env"),
    "-f",
    context.composeFile,
  ];
}

/** @param {string} root
 * @param {string} path */
function assertNoSymbolicLinks(root, path) {
  const parts = relative(root, resolve(path)).split(sep);
  let current = root;
  for (const part of parts) {
    current = resolve(current, part);
    try {
      if (lstatSync(current).isSymbolicLink())
        throw new Error("#461 proof directory cannot use symbolic links");
    } catch (error) {
      if (
        typeof error !== "object" ||
        error === null ||
        !("code" in error) ||
        error.code !== "ENOENT"
      )
        throw error;
    }
  }
}

/** @param {ReturnType<typeof createMiniAppIdentityProofContext>} context */
export function prepareMiniAppIdentityProofContext(context) {
  // Configuration only: this command does not generate keys, contact providers or start services.
  if (
    !isDeepStrictEqual(
      context,
      createMiniAppIdentityProofContext(context.worktree),
    )
  )
    throw new Error("#461 proof context does not match its isolated namespace");
  assertNoSymbolicLinks(context.worktree, context.directory);
  mkdirSync(context.directory, { recursive: true, mode: 0o700 });
  const contextPath = resolve(context.directory, "context.json");
  if (existsSync(contextPath))
    readMiniAppIdentityProofContext(contextPath, context.worktree);
  assertNoSymbolicLinks(
    context.worktree,
    resolve(context.directory, "compose.env"),
  );
  writeFileSync(contextPath, `${JSON.stringify(context, null, 2)}\n`, {
    mode: 0o600,
  });
  writeFileSync(
    resolve(context.directory, "compose.env"),
    [
      `MINI_APP_PROOF_PROJECT=${context.project}`,
      `MINI_APP_PROOF_IMAGE=${context.image}`,
      `MINI_APP_PROOF_TLS_DIRECTORY=${resolve(context.directory, "tls")}`,
      ...Object.entries(context.ports).map(
        ([name, port]) => `MINI_APP_PROOF_${name.toUpperCase()}_PORT=${port}`,
      ),
      "",
    ].join("\n"),
    { mode: 0o600 },
  );
  return contextPath;
}

/** @typedef {(file: string, args: string[], options: { encoding: "utf8", timeout: number }) => string} ProofInventory
 * @param {ReturnType<typeof createMiniAppIdentityProofContext>} context
 * @param {ProofInventory} [run] */
export function assertMiniAppIdentityProofAvailable(
  context,
  run = execFileSync,
) {
  const containers = run(
    "docker",
    [
      "ps",
      "--all",
      "--filter",
      `label=com.docker.compose.project=${context.project}`,
      "--format",
      "{{.ID}}",
    ],
    { encoding: "utf8", timeout: 10_000 },
  );
  if (containers.trim() !== "")
    throw new Error(
      "#461 proof namespace is occupied; preserve its containers and investigate ownership",
    );
  for (const resource of ["volume", "network"]) {
    const leftovers = run(
      "docker",
      [
        resource,
        "ls",
        "--filter",
        `name=${context.project}_`,
        "--format",
        "{{.Name}}",
      ],
      { encoding: "utf8", timeout: 10_000 },
    );
    if (leftovers.trim() !== "")
      throw new Error(
        "#461 proof namespace is occupied; preserve its volumes/networks and investigate ownership",
      );
  }
  // lsof returns 1 when none of the selected ports has a listener.
  try {
    const listeners = run(
      "lsof",
      [
        "-a",
        "-nP",
        ...Object.values(context.ports).map((port) => `-iTCP:${port}`),
        "-sTCP:LISTEN",
        "-Fp",
      ],
      { encoding: "utf8", timeout: 10_000 },
    );
    if (listeners.trim() !== "")
      throw new Error(
        "#461 proof ports are occupied; do not stop their owners",
      );
  } catch (error) {
    if (
      typeof error !== "object" ||
      error === null ||
      !("status" in error) ||
      error.status !== 1 ||
      !("stdout" in error) ||
      String(error.stdout).trim() !== "" ||
      !("stderr" in error) ||
      String(error.stderr).trim() !== ""
    )
      throw error;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const context = createMiniAppIdentityProofContext(root);
  switch (process.argv[2]) {
    case "plan":
      process.stdout.write(`${JSON.stringify(context, null, 2)}\n`);
      break;
    case "prepare":
      process.stdout.write(`${prepareMiniAppIdentityProofContext(context)}\n`);
      break;
    case "preflight":
      assertMiniAppIdentityProofAvailable(context);
      process.stdout.write(
        "#461 namespace and candidate ports are free at preflight time; recheck immediately before launch.\n",
      );
      break;
    default:
      throw new Error(
        "Use plan, prepare or preflight; this command never launches services",
      );
  }
}
