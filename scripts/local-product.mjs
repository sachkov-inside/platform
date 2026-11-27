// @ts-check
// Restores the production-like product view on the local stand from the committed Course Studio
// originals: the AI Engineering product with its page, programme, files and videos, featured on Home. It is
// safe to repeat on any branch; the stand data lives in the shared Compose volumes.
import { execFileSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { syncGitLocal } from "../tools/authoring/git-local.mjs";
import { pnpmInvocation } from "./pnpm-invocation.mjs";
import { standIdentity, withStandGateway } from "./stand-gateway-session.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The account bootstrap grants the stored owner and the learner with access only the non-archived
 * Products present when it runs, and after a stand reset it runs before any transfer. Repeating it
 * after the transfer keeps the owner's access to his course (owner decision 2026-11-20). Its report
 * goes to stderr, so stdout keeps only this command's JSON receipt.
 *
 * @param {string} pnpmPath
 */
export function grantStandProductAccess(pnpmPath) {
  execFileSync(...pnpmInvocation(pnpmPath, ["local:accounts:bootstrap"]), {
    cwd: root,
    stdio: ["ignore", 2, 2],
  });
}

async function main() {
  // The stand's journal of transferred originals; keep it between runs.
  const standStateDirectory = "_local/platform-468/local-stand";

  const { values } = parseArgs({
    options: {
      "owner-email": { type: "string" },
      content: { type: "string" },
      product: { type: "string", default: "inside-ai-engineering" },
      ref: { type: "string", default: "HEAD" },
      "course-preview": { type: "boolean", default: false },
    },
  });
  const { email } = await standIdentity(values["owner-email"]);
  // Authoring lives in Materials independently of the primary checkout or assigned worktree.
  const content = resolve(
    values.content ?? resolve(homedir(), "Work", "Materials", "course-studio"),
  );
  if (!existsSync(resolve(content, "tools/content.py")))
    throw new Error(`Course Studio is not at ${content}; pass --content PATH`);
  const receipt = await withStandGateway(email, (origin) =>
    syncGitLocal(
      content,
      values.product,
      resolve(content, standStateDirectory),
      values.ref,
      // The stand restores the reader view, so this local profile approves every original (#804).
      {
        origin,
        pinHome: true,
        coursePreview: values["course-preview"],
        publish: "all",
      },
    ),
  );
  // Уведомления переноса показываются здесь же: иначе «пропажа» продукта осталась бы без объяснения.
  process.stdout.write(
    `${JSON.stringify({ commit: receipt.commit, coursePreview: receipt.coursePreview, applied: receipt.applied, unchanged: receipt.unchanged, homePinned: receipt.homePinned, product: receipt.products[0]?.url, archiveProposals: receipt.archiveProposals, notices: receipt.notices }, null, 2)}\n`,
  );
  grantStandProductAccess(process.env["npm_execpath"] ?? "pnpm");
}

if (
  process.argv[1] !== undefined &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
)
  await main();
