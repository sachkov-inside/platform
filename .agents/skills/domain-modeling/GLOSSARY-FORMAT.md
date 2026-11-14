Use this format for the domain/glossary file selected by the target harness; keep its existing filename.

# Domain glossary format

## Structure

```md
# {Context Name}

{One or two sentence description of what this context is and why it exists.}

## Language

**Order**:
{A one or two sentence description of the term}
_Avoid_: Purchase, transaction

**Invoice**:
A request for payment sent to a customer after delivery.
_Avoid_: Bill, payment request

**Customer**:
A person or organization that places orders.
_Avoid_: Client, buyer, account
```

## Rules

- **Be opinionated.** When multiple words exist for the same concept, pick the best one and list the others under `_Avoid_`.
- **Keep definitions tight.** One or two sentences max. Define what it IS, not what it does.
- **Only include terms specific to this project's context.** General programming concepts (timeouts, error types, utility patterns) don't belong even if the project uses them extensively. Before adding a term, ask: is this a concept unique to this context, or a general programming concept? Only the former belongs.
- **Group terms under subheadings** when natural clusters emerge. If all terms belong to a single cohesive area, a flat list is fine.

## Context layout

Use the glossary and context map declared by target `AGENTS.md`. A single-context
project has one vocabulary document; a multi-context map points to the declared
files for each context and describes their relationships. Preserve existing
`GLOSSARY.md`, `DOMAIN.md` and other declared names.

Read the relevant context's file before adding terms. If the layout is absent,
settle one under the project's requirements rules and create it lazily with the
first resolved term. Absence of a particular example filename does not mean no
glossary exists. Ask about context choice only when it remains ambiguous.
