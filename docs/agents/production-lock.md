# Production lock

One session changes production at a time. The **production lock** is the single open GitHub
Issue labelled `production-lock`. Its comments announce the work to the owner and to every other
session, and it becomes the release record of [release](../runbooks/release.md) step 8.

Workflow `concurrency` groups and the server `operation.lock` already serialize identical runs.
The lock covers what they cannot see: two sessions with the owner's permission planning releases,
deployments, backups and server windows at the same time without knowing about each other.

## When

Hold the lock for every production write:

- `release.yml`, `deploy.yml`, `telegram-release.yml` or `telegram-deploy.yml` (deploy or rollback);
- a write on the production server: foundation or host update, backup or restore check, cleanup,
  configuration, a maintenance window.

Read-only work runs without it: `production:verify`, `gh run view`, reading over SSH.

## Take

1. Have the owner's permission for this operation ([Owner gates](../../AGENTS.md#owner-gates)).
2. Check that production is free. Both lists are empty, or contain only your own lock and runs:

   ```bash
   gh issue list --label production-lock --state open --json number,title,url
   for workflow in release.yml deploy.yml telegram-release.yml telegram-deploy.yml; do
     gh run list --workflow "$workflow" --limit 3 --json databaseId,status,createdAt \
       --jq '.[] | select(.status != "completed")'
   done
   ```

   A lock or a run of another session means production is busy: wait, and ask the owner or your
   coordinator with its link. Only its holder or the owner closes a lock.
3. Open the lock Issue with label `production-lock` and the title
   `Production lock: <application> <operation> <version>`. The body names:
   - the session: agent, session or task ID, worktree and branch;
   - the owner's permission: quote and time;
   - the plan: workflows, server steps and their order;
   - the expected downtime and the rollback.
4. Repeat the Issue list. With two open locks, the lower number holds production; the other session
   closes its own lock with a link to the holder and waits.

## Announce

Comment on the lock with the URL of each workflow run as you start it, and before each maintenance
window with the expected downtime. That comment is the downtime announcement of release step 4. Record each
failure and change of plan in the lock as it happens.

## Release

Write the result as the final comment: version and SHA, run links, checks, actual downtime,
`free -m` and one-off server steps (release step 8). Then close the Issue. A session that ends with
production work unfinished keeps the lock open and states the remaining steps in it.
