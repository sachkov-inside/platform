# Issue tracker: GitHub

Issues and specs for this repository live in `sachkov-inside/platform` GitHub Issues. Run `gh`
inside this clone so repository identity comes from `git remote`.

Product decisions and cross-repository initiatives belong in Workspace; link the Workspace parent
rather than moving the Platform deliverable there. Tracked pull requests use `Closes #<number>`;
trivial docs/chore may use `N/A` instead.

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
- Use assignee-as-claim. An open, unblocked and unassigned child is on the frontier.
- Resolve a decision with a comment, close its issue, then add a one-line linked pointer to the
  map's `Decisions so far` section.
