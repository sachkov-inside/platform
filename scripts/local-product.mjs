// Restores the production-like product view on the local stand from the committed Inside Content
// originals: the AI-first product with its programme, files and videos, featured on Home. It is safe
// to repeat on any branch; the stand data lives in the shared Compose volumes.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { syncGitLocal } from "../tools/authoring/git-local.mjs";
import { resolveLocalTarget } from "../tools/authoring/target.mjs";
import { ensureSharedIdentityDirectory } from "./shared-identity-directory.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const gatewayStartTimeoutMs = 60_000;
// The stand's journal of transferred originals; keep it between runs.
const standStateDirectory = "_local/platform-468/local-stand";

async function isGatewayRunning(origin) {
  try {
    await fetch(`${origin}/__local-api/authoring/home-pin`, { signal: AbortSignal.timeout(2_000) });
    return true;
  } catch {
    return false;
  }
}

function startGateway(email) {
  const child = spawn(process.execPath, [resolve(root, "scripts/authoring-stand-gateway.mjs"), "--owner-email", email], {
    cwd: root,
    env: { ...process.env, NODE_EXTRA_CA_CERTS: resolve(root, ".identity-proof/tls/certificate.pem") },
    stdio: ["ignore", "pipe", "inherit"],
  });
  const ready = new Promise((accept, reject) => {
    const timer = setTimeout(() => reject(new Error("The authoring gateway did not start in time")), gatewayStartTimeoutMs);
    child.stdout.on("data", (chunk) => { if (String(chunk).includes("Authoring gateway for the stand")) { clearTimeout(timer); accept(); } });
    child.once("exit", (code) => { clearTimeout(timer); reject(new Error(`The authoring gateway stopped with code ${String(code)}`)); });
  });
  return { child, ready };
}

const { values } = parseArgs({ options: {
  "owner-email": { type: "string" },
  content: { type: "string" },
  guide: { type: "string", default: "working-with-agents" },
  ref: { type: "string", default: "HEAD" },
} });
const identity = ensureSharedIdentityDirectory(root);
const stored = await readFile(resolve(identity, "authoring-owner-pat.json"), "utf8").then((text) => JSON.parse(text).email).catch(() => undefined);
const email = values["owner-email"] ?? stored;
if (!email) throw new Error("Usage: pnpm local:product --owner-email STAND_AUTHOR_EMAIL (the author signed in to the stand and holds materials:manage)");
// Linked worktrees sit elsewhere, so the originals are found next to the primary checkout.
const content = resolve(values.content ?? resolve(dirname(identity), "..", "inside-content"));
if (!existsSync(resolve(content, "tools/content.py"))) throw new Error(`Inside Content is not at ${content}; pass --content PATH`);
const origin = resolveLocalTarget("stand");
const gateway = await isGatewayRunning(origin) ? undefined : startGateway(email);
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => { gateway?.child.kill("SIGTERM"); process.exit(1); });
}
try {
  await gateway?.ready;
  const receipt = await syncGitLocal(content, values.guide, resolve(content, standStateDirectory), values.ref, { origin, pinHome: true });
  process.stdout.write(`${JSON.stringify({ commit: receipt.commit, applied: receipt.applied, unchanged: receipt.unchanged, homePinned: receipt.homePinned, product: receipt.guides[0]?.url, archiveProposals: receipt.archiveProposals }, null, 2)}\n`);
} finally {
  gateway?.child.kill("SIGTERM");
}
