// @ts-check
// Runs one piece of work through the stand's authoring gateway: reuses a running gateway or starts
// one for the duration of the work, because the gateway acts as the stand owner while it runs.
import { spawnOwned, stopOwned } from "./owned-process.mjs";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";

import { refusal } from "../tools/authoring/refusal.mjs";
import { resolveLocalTarget } from "../tools/authoring/target.mjs";
import {
  gatewayIdentityPath,
  gatewayService,
} from "./authoring-stand-gateway.mjs";
import { ensureSharedIdentityDirectory } from "./shared-identity-directory.mjs";

const execute = promisify(execFile);

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const gatewayStartTimeoutMs = 60_000;

const gatewayIdentitySchema = z
  .object({
    service: z.literal(gatewayService),
    protocol: z.literal(1),
    owner: z.string().min(1),
    api: z.string().min(1),
    pid: z.number().int().positive(),
    root: z.string().min(1),
  })
  .passthrough();

/** @typedef {z.infer<typeof gatewayIdentitySchema>} GatewayIdentity */

/**
 * What answers on the gateway port: nothing, this repository's gateway, or another process.
 * Any HTTP answer is not enough; the gateway must report its identity.
 *
 * @param {string} origin
 * @returns {Promise<
 *   | { kind: "free" }
 *   | { kind: "gateway"; identity: GatewayIdentity }
 *   | { kind: "foreign"; detail: string }
 * >}
 */
export async function probeGateway(origin) {
  /** @type {Response} */
  let response;
  try {
    response = await fetch(`${origin}${gatewayIdentityPath}`, {
      redirect: "error",
      signal: AbortSignal.timeout(2_000),
    });
  } catch (error) {
    const cause =
      error instanceof Error && error.cause instanceof Error
        ? error.cause
        : undefined;
    if (cause !== undefined && "code" in cause && cause.code === "ECONNREFUSED")
      return { kind: "free" };
    return { kind: "foreign", detail: `no HTTP answer (${String(error)})` };
  }
  const text = await response.text();
  if (!response.ok)
    return { kind: "foreign", detail: `HTTP ${String(response.status)}` };
  try {
    return {
      kind: "gateway",
      identity: gatewayIdentitySchema.parse(JSON.parse(text)),
    };
  } catch {
    return { kind: "foreign", detail: "an answer without gateway identity" };
  }
}

/** @param {string} port */
async function portOwner(port) {
  try {
    const { stdout } = await execute("lsof", [
      "-nP",
      `-iTCP:${port}`,
      "-sTCP:LISTEN",
      "-Fpc",
    ]);
    const pid = /^p(\d+)$/mu.exec(stdout)?.[1];
    const command = /^c(.+)$/mu.exec(stdout)?.[1];
    return pid === undefined
      ? ""
      : ` (PID ${pid}${command ? `, ${command}` : ""})`;
  } catch {
    return "";
  }
}

/** @param {string} email */
function startGateway(email) {
  const child = spawnOwned(
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
    let output = "";
    child.stdout?.on("data", (chunk) => {
      output += String(chunk);
      if (output.includes("Authoring gateway for the stand")) {
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
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
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
 * Runs the work through a verified stand gateway: reuses a running one for the same owner or
 * starts one for the duration of the work and stops it afterwards. Another process on the port
 * is refused by name instead of being treated as the gateway.
 *
 * @template T
 * @param {string} email
 * @param {(origin: string, gateway: { identity: GatewayIdentity; started: boolean }) => Promise<T>} work
 * @returns {Promise<T>}
 */
export async function withStandGateway(email, work) {
  const origin = resolveLocalTarget("stand");
  const port = new URL(origin).port;
  const found = await probeGateway(origin);
  if (found.kind === "foreign")
    throw refusal(
      "gateway_port_busy",
      `${origin} is held by a process that is not the stand authoring gateway${await portOwner(port)}: ${found.detail}. ` +
        "Stop it (an older gateway or a pre-#1672 pnpm editor:local used this port) and repeat",
    );
  if (found.kind === "gateway") {
    if (found.identity.owner.toLowerCase() !== email.toLowerCase())
      throw refusal(
        "gateway_owner_mismatch",
        `The running stand gateway (PID ${String(found.identity.pid)}) acts as ${found.identity.owner}, not ${email}; stop it or deliver as its owner`,
      );
    return work(origin, { identity: found.identity, started: false });
  }
  const gateway = startGateway(email);
  const child = gateway.child;
  /** @param {NodeJS.Signals} signal */
  async function interrupted(signal) {
    await stopOwned(child);
    process.exit(signal === "SIGINT" ? 130 : 143);
  }
  const interrupt = () => {
    void interrupted("SIGINT");
  };
  const terminate = () => {
    void interrupted("SIGTERM");
  };
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", terminate);
  try {
    await gateway.ready;
    const started = await probeGateway(origin);
    if (started.kind !== "gateway")
      throw refusal(
        "gateway_unverified",
        "The started stand gateway does not report its identity",
      );
    return await work(origin, { identity: started.identity, started: true });
  } finally {
    process.removeListener("SIGINT", interrupt);
    process.removeListener("SIGTERM", terminate);
    await stopOwned(child);
  }
}
