// @ts-check
// Restores the production-like product view on the local stand from the committed Engineering Content
// originals: the AI-first product with its page, programme, files and videos, featured on Home. It is
// safe to repeat on any branch; the stand data lives in the shared Compose volumes.
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import process from "node:process";
import { parseArgs } from "node:util";

import { syncGitLocal } from "../tools/authoring/git-local.mjs";
import { standIdentity, withStandGateway } from "./stand-gateway-session.mjs";

// The stand's journal of transferred originals; keep it between runs.
const standStateDirectory = "_local/platform-468/local-stand";

const { values } = parseArgs({
  options: {
    "owner-email": { type: "string" },
    content: { type: "string" },
    product: { type: "string", default: "working-with-agents" },
    ref: { type: "string", default: "HEAD" },
    "course-preview": { type: "boolean", default: false },
  },
});
const { email } = await standIdentity(values["owner-email"]);
// Authoring lives in Materials independently of the primary checkout or assigned worktree.
const content = resolve(
  values.content ?? resolve(homedir(), "Work", "Materials", "engineering-content"),
);
if (!existsSync(resolve(content, "tools/content.py")))
  throw new Error(`Engineering Content is not at ${content}; pass --content PATH`);
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
