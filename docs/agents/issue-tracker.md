# Issue tracker: GitHub

Issues and specs for this repository live in `sachkov-inside/platform` GitHub Issues. Run `gh`
inside this clone so repository identity comes from `git remote`.

State of a task is the issue, its labels and its linked pull request; there are no Project boards.
A specification is an issue and its tasks are its sub-issues. Tracked pull requests use
`Closes #<number>`.

Pull requests are not an external request surface for triage. A bare `#<number>` can still be an
issue or PR because GitHub shares their number space; resolve it before acting.

## Wayfinder

- A map is an issue labelled `wayfinder:map`; its decision tickets are GitHub sub-issues labelled
  `wayfinder:research|prototype|grilling|task`.
- Link a child with
  `gh api --method POST repos/{owner}/{repo}/issues/{map}/sub_issues -F sub_issue_id={child-db-id}`.
  Get the database id with `gh api repos/{owner}/{repo}/issues/{child} --jq .id`.
- Add blocking with
  `gh api --method POST repos/{owner}/{repo}/issues/{child}/dependencies/blocked_by -F issue_id={blocker-db-id}`.
  If either endpoint is unavailable, record `Part of #<map>` or `Blocked by: #<issue>` in the child
  body instead.
- A ticket is taken when the remote has its branch or a linked open pull request; `WORKFLOW.md`
  names the check. Assignee records the responsible human.
- Resolve a decision with a comment, close its issue, then add a one-line linked pointer to the
  map's `Decisions so far` section.
