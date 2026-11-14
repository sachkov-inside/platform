---
name: domain-modeling
description: Build and sharpen a project's domain model. Use when discussing codebase terminology, writing or editing the project's domain/glossary document, or recording or editing an ADR.
---

# Domain Modeling

Actively build and sharpen the project's domain model as you design. This is the *active* discipline: challenging terms, inventing edge-case scenarios, and writing the glossary and decisions down the moment they crystallise. (Merely *reading* the domain document for vocabulary is not this skill: that's a one-line habit any skill can do. This skill is for when you're changing the model, not just consuming it.)

## Project domain contract

Read root `AGENTS.md` and its domain/ADR pointers before writing. Keep the project's
chosen names, locations, context map and ownership. Existing `GLOSSARY.md` and
the domain document are equally valid; this skill does not migrate one to the other.
For multiple contexts, follow the project's map and read only relevant contexts.

Create a glossary or ADR lazily, when there is an agreed result to record. If no
layout exists, propose one concrete layout and settle it under the project's
requirements rules before creating files. A domain document holds vocabulary;
scenarios, implementation decisions and specs keep their own project locations.

## During the session

### Challenge against the glossary

When the user uses a term that conflicts with the existing language in the domain document, call it out immediately. "Your glossary defines 'cancellation' as X, but you seem to mean Y. Which is it?"

### Sharpen fuzzy language

When the user uses vague or overloaded terms, propose a precise canonical term. "You're saying 'account': do you mean the Customer or the User? Those are different things."

### Discuss concrete scenarios

When domain relationships are being discussed, stress-test them with specific scenarios. Invent scenarios that probe edge cases and force the user to be precise about the boundaries between concepts.

### Offer a practice when the signs are there

When the conversation shows several actors or modules, failure paths, states, or a word with more than one meaning, offer the fitting practice in one sentence: walk the process step by step, check the boundaries, or work through examples for a disputed rule. For simple work, offer nothing. The user decides.

Write the outcome of such a walkthrough as text in the issue or spec, not in the domain document: steps, rules, examples and open questions. Offer a board only when the user asks to see it or the text has grown too long to follow.

### Cross-reference with code

When the user states how something works, check whether the code agrees. If you find a contradiction, surface it: "Your code cancels entire Orders, but you just said partial cancellation is possible. Which is right?"

### Update the domain document inline

When a term is resolved, update the domain document right there. Don't batch these up: capture them as they happen. Use the format in [GLOSSARY-FORMAT.md](./GLOSSARY-FORMAT.md).

the domain document should be totally devoid of implementation details. Do not treat the domain document as a spec, a scratch pad, or a repository for implementation decisions. It is a glossary and nothing else.

### Offer ADRs sparingly

Only offer to create an ADR when all three are true:

1. **Hard to reverse**: the cost of changing your mind later is meaningful
2. **Surprising without context**: a future reader will wonder "why did they do it this way?"
3. **The result of a real trade-off**: there were genuine alternatives and you picked one for specific reasons

If any of the three is missing, skip the ADR. Use the format in [ADR-FORMAT.md](./ADR-FORMAT.md).
