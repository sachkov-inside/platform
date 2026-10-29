# AI Engineering course acceptance

A local preview of the AI Engineering course on the shared stand.

## AI Engineering course acceptance stand

`pnpm local:stand --production-web` starts the full local environment. Use the production web build
for manual reading and navigation checks; the development server compiles routes on demand.
Then run `pnpm local:course` (optionally `--owner-email EMAIL` on first use). It uses the same
owner sign-in/bootstrap and persistent journal as `local:product`, and selects an explicit **local preview** for `inside-ai-engineering`. The Platform command retains `--product`; its Content subprocess calls `export-platform --guide`.
The source repository can be selected with `--content PATH`;
`--ref COMMIT` pins the chosen content revision.

The local preview leaves the original package and Content files unchanged. It creates a separately
hashed package in which practice definitions are published only in this local copy. Lesson and
Task access stay as authored in Content, with the `closed` default for a lesson that names none, so
the stand shows the access production has (owner request of 2026-10-28; the earlier profile of
#1284 made `project-setup` free). Opening a chapter is a Content change that travels to both
targets, and its lessons keep their protected recordings
([ADR 0041](../adr/0041-protected-recording-serves-any-access.md)). The profile accepts any
programme of `inside-ai-engineering`; source IDs, chapter composition and lesson editorial stages
remain unchanged. The receipt records both package
paths and `coursePreview: true`. Repeat the same command after committing edits in Obsidian/Content;
refresh the browser. It is a one-shot committed sync, not a watcher for unsaved edits.

Open `/products/ai-engineering` and `/products/ai-engineering/programme`. The programme
includes closed lessons. Use a fresh test email to see the unpaid view; sign-in codes and receipt
confirmation messages stay in Mailpit. The local test offer created for #796 costs 30 RUB and uses
the bank double. Its saved product grant is perpetual and the historical fixture sets support to six months.
The [23 October decision](../product/access-model.md#единая-выдача-доступа-решение-владельца-23102026)
changes the target course term; the local fixture and saved stand data require explicit alignment in
the refactoring work. This runbook records the existing fixture, not proof of the new configuration. Existing checkout
and legal wording still needs the separately tracked offer review; this is no approval of public
course terms or price. The offer and account progress persist in the stand volume.

The stand bootstrap also runs the production
[learner access provisioning](learning-practice-review.md#universal-learner-access-938) for the stand
learner MCP `http://127.0.0.1:3002/mcp/learning`. Every local account gets the default role with
`learning:read`, dynamic apps (CIMD) are off, and every agent uses the public Native client. The
bootstrap writes the address and that client ID into `.identity-proof/stand.env`, so Reader and
`/practice-review-setup.txt` on the stand show them. Connect any MCP client and log in with the same
test account as the website; codes arrive in Mailpit. The copied lesson request calls only
the learner endpoint `/mcp/learning`, and access still follows that account's product rights.

Local TLS uses a CA and a separate server leaf (the old pair is preserved when upgraded), bundled in
`.identity-proof/tls/certificate.pem`. MCP also mounts that CA for its outgoing Logto verification.
An agent on the host trusts the stand Logto through this file, for example with
`NODE_EXTRA_CA_CERTS` or `SSL_CERT_FILE`; do not disable TLS checks. The browser may require accepting the local certificate once.
This local OAuth setup does not configure production or certify other native clients.
