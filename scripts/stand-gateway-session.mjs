// @ts-check
// Runs one piece of work through the stand's authoring gateway: reuses a running gateway or starts
// one for the duration of the work, because the gateway acts as the stand owner while it runs.
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { resolveLocalTarget } from "../tools/authoring/target.mjs";
import { ensureSharedIdentityDirectory } from "./shared-identity-directory.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const gatewayStartTimeoutMs = 60_000;

/** @param {string} origin */
async function isGatewayRunning(origin) {
  try {
    await fetch(`${origin}/__local-api/authoring/home-pin`, {
      signal: AbortSignal.timeout(2_000),
    });
    return true;
  } catch {
    return false;
  }
}

/** @param {string} email */
function startGateway(email) {
  // deterministic-test-allow process-cleanup: Legacy command needs verified group cleanup on interruption; migration is tracked in #1154.
  const child = spawn(
    process.execPath,
    [
      resolve(root, "scripts/authoring-stand-gateway.mjs"),
      "--owner-email",
      email,
    ],
    {
      cwd: root,
      env: {
        ...process.env,
        NODE_EXTRA_CA_CERTS: resolve(
          root,
          ".identity-proof/tls/certificate.pem",
        ),
      },
      stdio: ["ignore", "pipe", "inherit"],
    },
  );
  /** @type {Promise<void>} */
  const ready = new Promise((accept, reject) => {
    const timer = setTimeout(
      () => reject(new Error("The authoring gateway did not start in time")),
      gatewayStartTimeoutMs,
    );
    child.stdout.on("data", (chunk) => {
      if (String(chunk).includes("Authoring gateway for the stand")) {
        clearTimeout(timer);
        accept();
      }
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(
        new Error(`The authoring gateway stopped with code ${String(code)}`),
      );
    });
  });
  return { child, ready };
}

/**
 * The shared identity directory and the stand author's email, stored by an earlier gateway run.
 *
 * @param {string | undefined} ownerEmail
 * @returns {Promise<{ identity: string; email: string }>}
 */
export async function standIdentity(ownerEmail) {
  const identity = ensureSharedIdentityDirectory(root);
  const stored = await readFile(
    resolve(identity, "authoring-owner-pat.json"),
    "utf8",
  )
    .then((text) => {
      /** @type {unknown} */
      const saved = JSON.parse(text);
      return typeof saved === "object" &&
        saved !== null &&
        "email" in saved &&
        typeof saved.email === "string"
        ? saved.email
        : undefined;
    })
    .catch(() => undefined);
  const email = ownerEmail ?? stored;
  if (!email)
    throw new Error(
      "Pass --owner-email STAND_AUTHOR_EMAIL (the author signed in to the stand and holds materials:manage)",
    );
  return { identity, email };
}

/**
 * @template T
 * @param {string} email
 * @param {(origin: string) => Promise<T>} work
 * @returns {Promise<T>}
 */
export async function withStandGateway(email, work) {
  const origin = resolveLocalTarget("stand");
  const gateway = (await isGatewayRunning(origin))
    ? undefined
    : startGateway(email);
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, () => {
      gateway?.child.kill("SIGTERM");
      process.exit(1);
    });
  }
  try {
    await gateway?.ready;
    return await work(origin);
  } finally {
    gateway?.child.kill("SIGTERM");
  }
}
