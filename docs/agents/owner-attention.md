# Owner attention

Platform's conditions for the `owner-attention` skill, which decides before a merge whether the
owner must look. Only the owner changes this file: the plan names a change to it as his decision, and a change the
plan does not name gives «Требуется внимание». A new case in the history appears from his
correction. Keep it within one page.

## Always show before the merge

Named in the plan as a key scenario, these give «Требуется решение»; missing from the plan, they
give «Требуется внимание».

- New behaviour for a user, except the small planned visible change below.
- A look of the interface that no approved design contains.
- Money: price, renewal, refund, paid access.
- Access: who enters a section and what they see there.
- Personal data and legal texts.

## Call when the plan does not name it

These give «Требуется внимание».

- A data migration or deletion.
- A change to a shared contract: API, MCP, Telegram.
- The text of emails and bot messages.

## Call when evidence is thin

These give «Требуется внимание».

- A scenario the plan asked to show is not shown. For an owner-assigned task, its text is the
  plan; implementation-derived scenarios need no separate approval.
- Verification failed.
- An unresolved review finding about a consequence for the user, money, access, personal data or
  an irreversible action; or a verifier's note about the change itself or its consequence for users.
  A note on the changed interface counts. An unrelated defect becomes a linked Issue, not a call.
- A stand or light-instance limit is recorded as «Не проверено», without calling the owner,
  unless it prevents a scenario the plan asked to show. For example, an unavailable Telegram
  response outside those scenarios is a limit, not failed verification of the change.
- CI is not green on the last commit.

A technical review finding stays with the agents
([technical acceptance](human-review.md#two-acceptances)).

## Without the owner

With nothing above, these give «Внимание не требуется».

- Documents, tests, CI, tools.
- A bug fix with a test that failed before the fix.
- A visible change that follows the plan, up to 5 files. This exception takes precedence over
  «New behaviour for a user» only. An explicit key scenario, money, access, personal data, legal
  texts, an interface without approved design and thin evidence still call the owner.

## Only on the owner's command

No status permits these.

- A deployment to production or a write on the production server.
- A release, a real payment, credentials.

## Cases from history

- #1958: a line beside the price promised a way to pay. That is money.
- #1880: a fix changed who enters the authoring section. That is access.
- #2089: a buyer's Telegram name went into the message to the seller. That is personal data.
- #2170: a key stored in the browser required a new edition of the cookies text. That is a legal
  text.
