# Throwaway prototype #1277 · Part of #940

Question: how should a quiz read inside the existing Reader?

Run from this worktree: `pnpm storybook`. Open
`http://localhost:6006/iframe.html?id=prototypes-quiz-reader-1277--playground&viewMode=story&variant=A`.
Use `variant=A`, `B`, or `C`. The bottom switcher changes that URL parameter.
Arrow keys cycle when focus is outside an interactive control. Buttons use Enter/Space.
The scenario selector demonstrates unanswered, correct, incorrect, “Не знаю” and all explanations.

- **A — Встроенный блок (recommendation):** visible choices, explanation below, reading continues.
- **B — Раскрываемая проверка:** optional disclosure occupies less space, but hides the question initially.
- **C — Разворот вопроса:** question beside choices; feedback replaces choices until retry. Mobile stacks both columns.

Data: synthetic `readerBlocks` fixture in the accepted Content v2 shape.
The fixture-only adapter supports its plain paragraphs and level-two headings; it is not a Markdown importer.
The existing Reader's `modeHint` presentation slot inserts the quiz at the fixture position.
No production module, registry, import, database or course export changes.
The prototype lives exclusively in the Storybook dependency graph. Its switcher remains available in the saved Storybook build.
Answers and retries live in component memory and reset on reload, variant or scenario change.

Owner acceptance is pending. Do not merge this branch. #1277 and #940 remain open.
Gate: WORKFLOW.md, Routes: “before that label, the owner accepts its prototype”.
It applies because the quiz adds an interactive surface. #940 also reserves prototype acceptance for the owner.
