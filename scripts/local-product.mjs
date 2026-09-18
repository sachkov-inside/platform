// Restores the production-like product view on the local stand from the committed Inside Content
// originals: the AI-first product with its page, programme, files and videos, featured on Home. It is
// safe to repeat on any branch; the stand data lives in the shared Compose volumes.
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { parseArgs } from "node:util";

import { syncGitLocal } from "../tools/authoring/git-local.mjs";
import { standIdentity, withStandGateway } from "./stand-gateway-session.mjs";

// The stand's journal of transferred originals; keep it between runs.
const standStateDirectory = "_local/platform-468/local-stand";

const { values } = parseArgs({ options: {
  "owner-email": { type: "string" },
  content: { type: "string" },
  guide: { type: "string", default: "working-with-agents" },
  ref: { type: "string", default: "HEAD" },
} });
const { identity, email } = await standIdentity(values["owner-email"]);
// Linked worktrees sit elsewhere, so the originals are found next to the primary checkout.
const content = resolve(values.content ?? resolve(dirname(identity), "..", "inside-content"));
if (!existsSync(resolve(content, "tools/content.py"))) throw new Error(`Inside Content is not at ${content}; pass --content PATH`);
const receipt = await withStandGateway(email, (origin) => syncGitLocal(content, values.guide, resolve(content, standStateDirectory), values.ref, { origin, pinHome: true }));
// Уведомления переноса показываются здесь же: иначе «пропажа» продукта осталась бы без объяснения.
process.stdout.write(`${JSON.stringify({ commit: receipt.commit, applied: receipt.applied, unchanged: receipt.unchanged, homePinned: receipt.homePinned, product: receipt.guides[0]?.url, archiveProposals: receipt.archiveProposals, notices: receipt.notices }, null, 2)}\n`);
