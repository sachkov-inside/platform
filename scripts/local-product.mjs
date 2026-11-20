// @ts-check
// Restores the production-like product view on the local stand from the committed Engineering Content
// originals: the AI Engineering product with its page, programme, files and videos, featured on Home. It is
// safe to repeat on any branch; the stand data lives in the shared Compose volumes.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { syncGitLocal } from "../tools/authoring/git-local.mjs";
import { pnpmInvocation } from "./pnpm-invocation.mjs";
import { standIdentity, withStandGateway } from "./stand-gateway-session.mjs";

/**
 * The account bootstrap grants the local owner and the learner with access every Product, but only
 * those present when it runs. After a stand reset it runs before any import, so the import repeats it:
 * otherwise the owner reads his own course as a learner without access.
 *
 * @template T
 * @param {{ importProduct: () => Promise<T>, grantStandAccess: () => Promise<void> }} steps
 */
export async function restoreLocalProduct({ importProduct, grantStandAccess }) {
  const receipt = await importProduct();
  await grantStandAccess();
  return receipt;
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
    values.content ?? resolve(homedir(), "Work", "Materials", "content-studio"),
  );
  if (!existsSync(resolve(content, "tools/content.py")))
    throw new Error(`Content Studio is not at ${content}; pass --content PATH`);
  const receipt = await restoreLocalProduct({
    importProduct: () =>
      withStandGateway(email, (origin) =>
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
      ),
    grantStandAccess: async () => {
      // Its report goes to stderr, so stdout keeps only this command's JSON receipt.
      execFileSync(
        ...pnpmInvocation(process.env["npm_execpath"] ?? "pnpm", [
          "local:accounts:bootstrap",
        ]),
        {
          cwd: resolve(fileURLToPath(import.meta.url), "../.."),
          stdio: ["ignore", 2, 2],
        },
      );
    },
  });
  // Уведомления переноса показываются здесь же: иначе «пропажа» продукта осталась бы без объяснения.
  process.stdout.write(
    `${JSON.stringify({ commit: receipt.commit, coursePreview: receipt.coursePreview, applied: receipt.applied, unchanged: receipt.unchanged, homePinned: receipt.homePinned, product: receipt.products[0]?.url, archiveProposals: receipt.archiveProposals, notices: receipt.notices }, null, 2)}\n`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
