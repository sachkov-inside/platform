import { spawnSync } from "node:child_process";
import {
  chmodSync,
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmSync,
  statfsSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryPolicyPath = resolve(
  repositoryRoot,
  "infra/production/secrets/secret-policy.json",
);
const installedPolicyPath = resolve(repositoryRoot, "secrets/secret-policy.json");
const policyPath = existsSync(repositoryPolicyPath)
  ? repositoryPolicyPath
  : installedPolicyPath;
const policy = JSON.parse(readFileSync(policyPath, "utf8"));
const generationPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
const productionRuntimeRoot = "/run/inside/secrets";
const tmpfsMagic = 0x01_02_19_94;

export function validateEncryptedDocument(document) {
  if (!isRecord(document) || !isRecord(document.sops)) {
    throw new Error("SOPS metadata is required");
  }
  const ageEntries = document.sops.age;
  if (!Array.isArray(ageEntries)) {
    throw new Error("SOPS age recipients are required");
  }
  const recipients = ageEntries
    .map((entry) => (isRecord(entry) ? entry.recipient : undefined))
    .filter((value) => typeof value === "string");
  if (new Set(recipients).size < policy.minimumAgeRecipients) {
    throw new Error(
      `SOPS ciphertext requires at least ${String(policy.minimumAgeRecipients)} distinct age recipients`,
    );
  }
  if (typeof document.sops.mac !== "string" || !document.sops.mac.startsWith("ENC[")) {
    throw new Error("SOPS ciphertext MAC is required");
  }
}

export function validatePlaintextDocument(document) {
  if (
    !isRecord(document) ||
    document.schemaVersion !== policy.schemaVersion ||
    !isRecord(document.secrets)
  ) {
    throw new Error("Secret plaintext must match schemaVersion and secrets contract");
  }
  const expected = expectedSecretNames();
  const actual = Object.keys(document.secrets).sort();
  const missing = expected.filter((name) => !actual.includes(name));
  const unknown = actual.filter((name) => !expected.includes(name));
  if (missing.length > 0) {
    throw new Error(`Missing secret keys: ${missing.join(", ")}`);
  }
  if (unknown.length > 0) {
    throw new Error(`Unknown secret keys: ${unknown.join(", ")}`);
  }
  for (const name of expected) {
    const value = document.secrets[name];
    if (
      typeof value !== "string" ||
      value.length < 8 ||
      value.includes("\0") ||
      /[\r\n]/u.test(value)
    ) {
      throw new Error(`Secret key ${name} has an invalid value`);
    }
  }
  return document;
}

function expectedSecretNames() {
  const names = new Set();
  for (const service of Object.values(policy.services)) {
    for (const name of Object.values(service.secrets)) names.add(name);
  }
  return [...names].sort();
}

function parseArguments(arguments_) {
  const [command, ...tokens] = arguments_;
  const options = {};
  for (let index = 0; index < tokens.length; index += 2) {
    const name = tokens[index];
    const value = tokens[index + 1];
    if (!name?.startsWith("--") || value === undefined) {
      throw new Error("Every option must use --name value");
    }
    options[name.slice(2)] = value;
  }
  return { command, options };
}

function sops(arguments_, options = {}) {
  const result = spawnSync(process.env.SOPS_BINARY ?? "sops", arguments_, {
    encoding: "utf8",
    env: { ...process.env, ...options.environment },
    input: options.input,
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.error) {
    throw new Error("SOPS executable is unavailable");
  }
  if (result.status !== 0) {
    throw new Error("SOPS operation failed");
  }
  return result.stdout;
}

function encrypt(options) {
  requireOptions(options, ["host-recipient", "offline-recipient", "output"]);
  if (options["host-recipient"] === options["offline-recipient"]) {
    throw new Error("Host and offline age recipients must be distinct");
  }
  const plaintext = readFileSync(0, "utf8");
  validatePlaintextDocument(JSON.parse(plaintext));
  const ciphertext = sops(
    [
      "--encrypt",
      "--input-type", "json",
      "--output-type", "json",
      "--filename-override", "secrets.production.json",
      "--age", `${options["host-recipient"]},${options["offline-recipient"]}`,
      "/dev/stdin",
    ],
    { input: plaintext },
  );
  validateEncryptedDocument(JSON.parse(ciphertext));
  atomicWrite(resolve(options.output), ciphertext, 0o600);
  console.log("production ciphertext written for host and offline recipients");
}

function materialize(options, fixture = false) {
  const optionNames = ["age-key-file", "encrypted", "generation", "runtime-root"];
  if (fixture) optionNames.push("fixture-root");
  requireOptions(options, optionNames);
  if (!generationPattern.test(options.generation)) {
    throw new Error("Generation must use a bounded safe identifier");
  }
  const runtimeRoot = resolveRuntimeRoot(options["runtime-root"]);
  const encryptedPath = resolve(options.encrypted);
  const keyPath = resolve(options["age-key-file"]);
  const key = lstatSync(keyPath);
  const keyMode = key.mode & 0o777;
  if ((keyMode & 0o077) !== 0) {
    throw new Error("Age identity permissions must be owner-only");
  }
  if (fixture) {
    validateFixtureMaterialization(options, runtimeRoot, encryptedPath, keyPath);
  } else {
    validateProductionRuntimeRoot(runtimeRoot, true);
    if (key.uid !== 0) {
      throw new Error("Production age identity must be root-owned");
    }
  }
  validateEncryptedDocument(JSON.parse(readFileSync(encryptedPath, "utf8")));
  mkdirSync(runtimeRoot, { mode: 0o700, recursive: true });
  chmodSync(runtimeRoot, 0o700);
  const temporary = resolve(runtimeRoot, `.generation-${process.pid}`);
  const generation = resolve(runtimeRoot, options.generation);
  assertChild(runtimeRoot, temporary);
  assertChild(runtimeRoot, generation);
  if (lstatExists(generation)) {
    throw new Error("Secret generation already exists and is immutable");
  }
  const plaintext = sops(["--decrypt", "--output-type", "json", encryptedPath], {
    environment: { SOPS_AGE_KEY_FILE: keyPath },
  });
  const document = validatePlaintextDocument(JSON.parse(plaintext));

  rmSync(temporary, { force: true, recursive: true });
  mkdirSync(temporary, { mode: 0o700 });
  try {
    for (const [serviceName, service] of Object.entries(policy.services)) {
      const lines = Object.entries(service.secrets)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([environmentName, secretName]) =>
          `${environmentName}=${JSON.stringify(document.secrets[secretName])}`
        );
      atomicWrite(resolve(temporary, service.file), `${lines.join("\n")}\n`, 0o400);
      if (lines.length === 0) throw new Error(`Service ${serviceName} has no secret subset`);
    }
    atomicWrite(
      resolve(temporary, "manifest.json"),
      `${JSON.stringify({
        generation: options.generation,
        services: Object.keys(policy.services).sort(),
      }, undefined, 2)}\n`,
      0o400,
    );
    renameSync(temporary, generation);
    atomicSymlink(runtimeRoot, "current", options.generation);
  } finally {
    rmSync(temporary, { force: true, recursive: true });
  }
  console.log(
    `materialized generation ${options.generation} for ${String(Object.keys(policy.services).length)} services`,
  );
}

function validateProductionRuntimeRoot(runtimeRoot, create) {
  if (process.geteuid?.() !== 0) {
    throw new Error("Production secret lifecycle requires root");
  }
  if (runtimeRoot !== productionRuntimeRoot) {
    throw new Error(`Production runtime root must equal ${productionRuntimeRoot}`);
  }
  if (create) mkdirSync(runtimeRoot, { mode: 0o700, recursive: true });
  const runtime = statSync(runtimeRoot);
  if (runtime.uid !== 0 || (runtime.mode & 0o077) !== 0) {
    throw new Error("Production runtime root must be root-only");
  }
  if (statfsSync(runtimeRoot).type !== tmpfsMagic) {
    throw new Error("Production runtime root must be backed by tmpfs");
  }
}

function validateFixtureMaterialization(options, runtimeRoot, encryptedPath, keyPath) {
  const fixtureRoot = resolve(options["fixture-root"]);
  const temporaryRoot = resolve(tmpdir());
  assertChild(temporaryRoot, fixtureRoot);
  if (!/\/inside-secrets-smoke\.[^/]+$/u.test(fixtureRoot)) {
    throw new Error("Fixture root must be an isolated secrets-smoke directory");
  }
  for (const path of [runtimeRoot, encryptedPath, keyPath]) {
    assertChild(fixtureRoot, path);
  }
}

function validate(options) {
  requireOptions(options, ["encrypted"]);
  validateEncryptedDocument(JSON.parse(readFileSync(resolve(options.encrypted), "utf8")));
  console.log("production ciphertext recipient contract passed");
}

function cleanup(options) {
  requireOptions(options, ["generation", "runtime-root"]);
  const runtimeRoot = resolveRuntimeRoot(options["runtime-root"]);
  validateProductionRuntimeRoot(runtimeRoot, false);
  let current;
  try {
    current = readlinkSync(resolve(runtimeRoot, "current"));
  } catch {
    current = undefined;
  }
  if (options.generation === current) {
    throw new Error("Current secret generation cannot be removed");
  }
  if (!generationPattern.test(options.generation)) {
    throw new Error("Generation must use a bounded safe identifier");
  }
  const target = resolve(runtimeRoot, options.generation);
  assertChild(runtimeRoot, target);
  rmSync(target, { force: true, recursive: true });
  console.log("secret cleanup completed");
}

function resolveRuntimeRoot(value) {
  if (!isAbsolute(value)) throw new Error("Runtime root must be absolute");
  return resolve(value);
}

function atomicWrite(path, content, mode) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${String(process.pid)}.tmp`;
  const descriptor = openSync(temporary, "wx", mode);
  try {
    writeFileSync(descriptor, content);
  } finally {
    closeSync(descriptor);
  }
  try {
    chmodSync(temporary, mode);
    renameSync(temporary, path);
  } finally {
    unlinkIfPresent(temporary);
  }
}

function atomicSymlink(root, name, target) {
  const path = resolve(root, name);
  const temporary = resolve(root, `.${name}.${String(process.pid)}`);
  unlinkIfPresent(temporary);
  symlinkSync(target, temporary);
  renameSync(temporary, path);
}

function unlinkIfPresent(path) {
  try {
    unlinkSync(path);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

function assertChild(root, child) {
  if (child === root || !child.startsWith(`${root}/`)) {
    throw new Error("Secret path escapes runtime root");
  }
}

function requireOptions(options, names) {
  const missing = names.filter((name) => options[name] === undefined);
  if (missing.length > 0) throw new Error(`Missing options: ${missing.join(", ")}`);
  const unknown = Object.keys(options).filter((name) => !names.includes(name));
  if (unknown.length > 0) throw new Error(`Unknown options: ${unknown.join(", ")}`);
}

function lstatExists(path) {
  try {
    lstatSync(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function run() {
  const { command, options } = parseArguments(process.argv.slice(2));
  if (command === "encrypt") encrypt(options);
  else if (command === "materialize") materialize(options);
  else if (command === "materialize-fixture") materialize(options, true);
  else if (command === "validate") validate(options);
  else if (command === "cleanup") cleanup(options);
  else throw new Error(
    "Command must be encrypt, materialize, materialize-fixture, validate, or cleanup",
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    run();
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Secret operation failed");
    process.exitCode = 1;
  }
}
