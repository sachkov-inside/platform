# Native client evidence

Полный разбор проверок, ручные решения и ограничения:
[отчёт #785](../../../verification/issue-785-practice-review.md).

[matrix.json](matrix.json) сохраняет 51 историческую запись без превращения timeout, invalid и
manual pending в автоматические PASS. Исходные `/tmp` paths и SHA обозначают происхождение,
а не обещание постоянной доступности локальных каталогов. Raw transcripts и credentials не включены.

Постоянные примеры внутри репозитория:

- [Допустимая реализация](claude-feature-alternative.json).
- [Нарушенный критерий](claude-feature-missed.json).
- [Устаревшие свидетельства](claude-feature-stale.json).
- [Повторная проверка после исправления](codex-feature-recheck-after-scoped.json).
- [Настоящий дефект вместе с injection](codex-feature-adversarial-diagnostic-repeat.json).
- [Выбор между worktrees](codex-brief-multiple-scoped.json).
- [Необязательный диалог](claude-optional-dialogue.json).
- [Codex: обычный вывод](codex-human-output.md) и [Claude: обычный вывод](claude-human-output.md).

Отдельно: [наблюдаемые команды](observed-boundary.md), [границы text-output](human-output.json),
[реальный sandbox engine probe](sandbox-engine.json) и
[cleanup раннего прерванного запуска](earlier-interrupted-cleanup.json).
