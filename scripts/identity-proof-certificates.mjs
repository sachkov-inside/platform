import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";

const outputDirectory = resolve(".identity-proof/tls");
const certificate = resolve(outputDirectory, "certificate.pem");
const privateKey = resolve(outputDirectory, "private-key.pem");

if (existsSync(certificate) && existsSync(privateKey)) {
  process.stdout.write(`Identity proof certificate already exists: ${certificate}\n`);
  process.exit(0);
}

mkdirSync(outputDirectory, { recursive: true, mode: 0o700 });
const result = spawnSync(
  "openssl",
  [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-sha256",
    "-nodes",
    "-days",
    "30",
    "-subj",
    "/CN=identity.inside.localhost",
    "-addext",
    "subjectAltName=DNS:identity.inside.localhost",
    "-keyout",
    privateKey,
    "-out",
    certificate,
  ],
  { encoding: "utf8" },
);

if (result.status !== 0) {
  process.stderr.write(result.stderr || "Unable to generate the proof certificate\n");
  process.exit(result.status ?? 1);
}

process.stdout.write(`Generated disposable identity proof certificate: ${certificate}\n`);
