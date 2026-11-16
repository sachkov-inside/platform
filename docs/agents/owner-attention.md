# Owner attention

Platform's conditions for the `owner-attention` skill, which decides before a merge whether the
owner must look. Only the owner changes this file: a change to it is named in the plan as his
decision, and a new case in the history appears from his correction. Keep it within one page.

## Always show before the merge

Named in the plan as a key scenario, these give «Требуется решение»; missing from the plan, they
give «Требуется внимание».

- New behaviour for a user.
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

- A scenario of the plan is not shown.
- Verification returned notes or failed.
- A review finding is open.
- CI is not green on the last commit.

## Without the owner

With nothing above, these give «Внимание не требуется».

- Documents, tests, CI, tools.
- A bug fix with a test that failed before the fix.
- A visible change that follows the plan, up to 5 files.

## Only on the owner's command

No status permits these.

- A deployment to production or a write on the production server.
- A release, a payment, credentials.

## Cases from history

- #1958: a line beside the price promised a way to pay. That is money.
- #1880: a fix changed who enters the authoring section. That is access.
- #2089: a buyer's Telegram name went into the message to the seller. That is personal data.
- #2170: a key stored in the browser required a new edition of the cookies text. That is a legal
  text.
