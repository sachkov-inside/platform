# Multiple-answer Material quiz

The Reader supports a local comprehension question with several correct options. It extends the existing `quiz-v1` block contract.

## Authored and rendered data

Legacy quizzes retain `correctOptionId` and 2–5 options. They keep their immediate single-choice interaction.

Multiple-answer quizzes declare `selectionMode: "multiple"` and `correctOptionIds`. They omit `correctOptionId` entirely. They accept 2–8 options and at least one correct option. Each correct ID must identify an existing option. Option IDs and correct IDs are distinct and nonblank; `dontKnow` remains reserved. Unknown modes, mixed answer keys and missing answer keys are invalid.

Content `readerBlocks` retain Markdown fields. Conversion produces the same answer mode and complete key in the rendered quiz. The document registry, editor JSON roundtrip and Reader share this validated representation. Narrative heading references and rich-content safety rules remain unchanged.

Packages containing this mode require `quiz-v1`, `github-anchors-v1` and `quiz-multiple-v1`. The authoring CLI refuses an unsupported or missing feature before transport. The receiver validates the rendered body through the shared registry. There is no separate server capability advertisement endpoint.

## Interaction

The Reader groups native checkboxes under “Выбери все подходящие варианты.” Choices have labelled controls and at least 44-pixel targets. The learner can select options with a pointer or keyboard. Selection reveals no answer feedback.

“Проверить” stays disabled for an empty selection. An explicit check succeeds only when the selected set equals the complete correct set. Feedback names the result and explains every option. A subset or an extra option is incorrect. Reordering the selection does not affect correctness.

“Не знаю” reveals the explanation without a grade. Editing any selection clears old feedback. The learner can check the new selection directly. Result text and icons accompany semantic colors; a live region announces feedback.

Answers stay in component state. This change adds no persisted quiz attempt, grading record, backend mutation, migration or Task requirement.

## Verification

Focused cases cover both schemas, package feature admission, Markdown conversion, accepted document/editor roundtrip, legacy choices and multiple-answer interaction. Storybook covers empty, exact, partial, extra, explanation, reselection, keyboard and phone states. Production route proof belongs to the subsequent deployed-source verification.
