# Issue tracker: GitHub

Issues and specs for this repository live in `sachkov-inside/platform` GitHub Issues. Run `gh`
inside this clone so repository identity comes from `git remote`.

Every pull request has one primary Platform issue and uses `Closes #<number>`. Product decisions
and cross-repository initiatives belong in Workspace; link the Workspace parent rather than moving
the Platform deliverable there. GitHub Project is an aggregate view, not the source of requirements.

## Operations

- Create: `gh issue create --title "..." --body "..."`.
- Read: `gh issue view <number> --comments`.
- List: `gh issue list --state open --json number,title,labels,assignees`.
- Comment: `gh issue comment <number> --body "..."`.
- Label: `gh issue edit <number> --add-label "..."` or `--remove-label "..."`.
- Claim: `gh issue edit <number> --add-assignee @me`.
- Close: `gh issue close <number> --comment "..."`.

Pull requests are not an external request surface for triage. A bare `#<number>` can still be an
issue or PR because GitHub shares their number space; resolve it before acting.

## Wayfinding operations

- A map is an issue labelled `wayfinder:map`; its decision tickets are GitHub sub-issues labelled
  `wayfinder:research|prototype|grilling|task`.
- Use native issue dependencies and assignee-as-claim. An open, unblocked and unassigned child is
  on the frontier.
- Resolve a decision with a comment, close its issue, then add a one-line linked pointer to the
  map's `Decisions so far` section.
