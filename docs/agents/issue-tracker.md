# Issue tracker: GitHub

Issues and specifications live in `sachkov-inside/platform` GitHub Issues; an issue goes to the
repository that owns its outcome. Run `gh` inside this clone so the repository comes from
`git remote`.

## Layers

- The product is a brief in `docs/product`.
- A version is an issue; its sub-issues are its specifications.
- A specification is an issue; its sub-issues are its tickets.
- A ticket is the work of one session: the issue, its labels and its linked pull request, which
  says `Closes #<ticket>`.

GitHub counts progress from sub-issues. There are no Project boards, issue types or milestones.

## Operations

- **Sub-issue**: `gh issue create --parent <parent> ...`, or
  `gh issue edit <parent> --add-sub-issue <child>` afterwards (`gh` 2.94+).
- **Blocking**: native issue dependencies,
  `gh api --method POST repos/{owner}/{repo}/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>`.
  The database id is `gh api repos/{owner}/{repo}/issues/<n> --jq .id`, not the `#number`. A ticket
  is unblocked when every blocker is closed.
- **Bare number**: GitHub shares one number space across issues and pull requests; resolve
  `#<number>` with `gh pr view` and fall back to `gh issue view`.

## Pull requests as a triage surface

**PRs as a request surface: no.**

## Wayfinding operations

Used by `/wayfinder`.

- **Map**: an issue labelled `wayfinder:map`, holding the Notes / Decisions-so-far / Fog body.
- **Child ticket**: a sub-issue of the map labelled `wayfinder:<type>`
  (`research`/`prototype`/`grilling`/`task`).
- **Frontier query**: the map's open sub-issues without an open blocker
  (`issue_dependencies_summary.blocked_by` is 0) and without an assignee; first in map order wins.
- **Claim**: `gh issue edit <n> --add-assignee @me`, the session's first write.
- **Resolve**: `gh issue comment <n> --body "<answer>"`, then `gh issue close <n>`, then append a
  context pointer (gist and link) to the map's Decisions-so-far.
