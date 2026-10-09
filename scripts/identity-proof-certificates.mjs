// @ts-check
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  copyFileSync,
  chmodSync,
} from "node:fs";
import { resolve } from "node:path";
import process from "node:process";

const outputDirectory = resolve(process.argv[2] ?? ".identity-proof/tls");
const certificate = resolve(outputDirectory, "certificate.pem");
const privateKey = resolve(outputDirectory, "private-key.pem");
const ca = resolve(outputDirectory, "ca.pem");
const caKey = resolve(outputDirectory, "ca-key.pem");
const leaf = resolve(outputDirectory, "leaf.pem");
const csr = resolve(outputDirectory, "leaf.csr");
const extensions = resolve(outputDirectory, "leaf.ext");

/** @param {string[]} args */
function openssl(args) {
  const result = spawnSync("openssl", args, { encoding: "utf8" });
  if (result.status !== 0)
    throw new Error(
      result.stderr || "Unable to generate the proof certificate",
    );
}

if ([certificate, privateKey, ca, leaf].every(existsSync)) {
  const valid = spawnSync("openssl", [
    "x509",
    "-in",
    leaf,
    "-checkend",
    "86400",
    "-noout",
  ]);
  if (valid.status === 0) {
    process.stdout.write(
      `Identity proof certificate already exists: ${certificate}\n`,
    );
    process.exit(0);
  }
}

mkdirSync(outputDirectory, { recursive: true, mode: 0o700 });
// Preserve a former self-signed layout (or expired pair) before replacing it.
if (existsSync(certificate) && existsSync(privateKey)) {
  const backup = resolve(outputDirectory, `previous-${Date.now()}`);
  mkdirSync(backup, { mode: 0o700 });
  for (const path of [certificate, privateKey, ca, caKey, leaf])
    if (existsSync(path))
      copyFileSync(
        path,
        resolve(backup, path.slice(path.lastIndexOf("/") + 1)),
      );
}
if (!existsSync(ca) || !existsSync(caKey)) {
  openssl([
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-sha256",
    "-nodes",
    "-days",
    "3650",
    "-subj",
    "/CN=Inside local development CA",
    "-addext",
    "basicConstraints=critical,CA:TRUE",
    "-addext",
    "keyUsage=critical,keyCertSign,cRLSign",
    "-keyout",
    caKey,
    "-out",
    ca,
  ]);
  chmodSync(caKey, 0o600);
}
openssl([
  "req",
  "-new",
  "-newkey",
  "rsa:2048",
  "-nodes",
  "-subj",
  "/CN=identity.inside.localhost",
  "-keyout",
  privateKey,
  "-out",
  csr,
]);
chmodSync(privateKey, 0o600);
writeFileSync(
  extensions,
  "basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:identity.inside.localhost\n",
);
openssl([
  "x509",
  "-req",
  "-in",
  csr,
  "-CA",
  ca,
  "-CAkey",
  caKey,
  "-CAcreateserial",
  "-days",
  "30",
  "-sha256",
  "-extfile",
  extensions,
  "-out",
  leaf,
]);
// The first certificate is the TLS leaf; Node and native clients can also trust the bundled CA.
writeFileSync(
  certificate,
  readFileSync(leaf, "utf8") + readFileSync(ca, "utf8"),
);
process.stdout.write(
  `Generated identity proof CA and server certificate: ${certificate}\n`,
);
