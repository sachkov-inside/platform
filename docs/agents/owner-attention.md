# Owner attention

Platform's conditions for the `owner-attention` skill, which decides before a merge whether the
owner must look. Only the owner changes this file; a new case in the history appears from his
correction. "Approved" means written in the plan (the specification or task), not said in a chat.

## Always show before the merge

The specification's author proposes these as key scenarios whenever the task touches them.

- New behaviour for a user.
- A look of the interface that no approved design contains.
- Money: price, renewal, refund, paid access.
- Access: who enters a section and what they see there.
- Personal data and legal texts.

## Call when the plan does not name it

- A data migration or deletion.
- A change to a shared contract: API, MCP, Telegram.
- The text of emails and bot messages.

## Call when evidence is thin

- A scenario of the plan is not shown.
- Verification returned notes or failed.
- A review finding is open.
- CI is not green on the last commit.

## Without the owner

- Documents, tests, CI, tools.
- A bug fix with a test that failed before the fix.
- A visible change that follows the plan, up to 5 files.

## Cases from history

- #1958: a line beside the price promised a way to pay. That is money.
- #1880: a fix changed who enters the authoring section. That is access.
- #2089: a buyer's Telegram name went into the message to the seller. That is personal data.
- #2170: a key stored in the browser required a new edition of the cookies text. That is a legal
  text.
