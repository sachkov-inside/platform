# Production lock

One session changes production at a time. The **production lock** is the single open GitHub
Issue labelled `production-lock`. Its comments announce the work to the owner and to every other
session, and it becomes the release record of [release](../runbooks/release.md) step 8.

Workflow `concurrency` groups and the server `operation.lock` already serialize runs: Platform and
Telegram deployments share the queue `production-server-deployment`. The lock covers what they cannot
see: two sessions with the owner's permission planning releases, deployments, backups and server
windows at the same time without knowing about each other.

## When

Hold the lock for every production write:

- a run of `release.yml`, `deploy.yml`, `telegram-release.yml` or `telegram-deploy.yml`, rollback
  included;
- a write on the production server: foundation or host update, backup or restore check, cleanup,
  configuration, a maintenance window.

Take it before any server `operation.lock` a runbook asks for. Read-only work runs without it:
`production:verify`, `gh run view`, reading over SSH.

## Take

1. Have the owner's permission for this operation ([Owner gates](../../AGENTS.md#owner-gates)).
2. Check that production is free. Both lists are empty, or contain only your own lock and runs:

   ```bash
   gh issue list --label production-lock --state open --json number,title,url
   for workflow in release.yml deploy.yml telegram-release.yml telegram-deploy.yml; do
     gh run list --workflow "$workflow" --limit 10 --json url,status,createdAt \
       --jq '.[] | select(.status != "completed")'
   done
   ```

   A lock or a run of another session means production is busy: wait, and ask the owner with its
   link, through your coordinator when you have one. Runs share one GitHub account, so a run not
   linked in your lock belongs to someone else.
3. Open the lock Issue with label `production-lock` and the title
   `Production lock: <application> <operation> <version or subject>`. The body names:
   - the session: agent, session or task ID, worktree and branch;
   - the owner's permission: quote and time;
   - the plan: workflows, server steps and their order;
   - the expected downtime and the rollback.
4. Wait 30 seconds, then repeat the Issue list: a new Issue reaches the label list only after a few
   seconds. With two open locks, the lower number holds production; the other session closes its
   own lock with a link to the holder and waits.

## Announce

Pass the lock number in the `lock` field of every run of the four workflows. Their first job,
[production-lock.yml](../../.github/workflows/production-lock.yml), refuses the run unless that Issue
is open, labelled `production-lock` and the lowest-numbered open lock. Comment on the lock with the
URL of each workflow run as you start it. Before each maintenance
window, name the expected downtime to the owner (release step 4) and record it in the lock. Record
each failure and change of plan in the lock as it happens.

## Close

Write the result as the final comment: version and SHA, run links, checks, actual downtime,
`free -m` and one-off server steps (release step 8). Then close the Issue. A session that ends with
production work unfinished keeps the lock open and states the remaining steps in it. Only its
holder or the owner closes a lock; another session takes it over on the owner's assignment and says
so in a comment.
