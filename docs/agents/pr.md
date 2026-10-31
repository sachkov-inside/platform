# PR body

The `pr` skill uses this template in place of its own. Write in the owner's language (Russian)
and keep the domain terms from the glossaries.

```markdown
## Что сделано

<the smallest view that shows the change: diagram, diff sketch, call or file tree>

## Проверка

- <command or check>: <result, exit code, head SHA>

## Риск merge

**Дверь:** <обратимая или необратимая> <one sentence why>
**Радиус:** <what can break and for whom>

## Нужно от владельца

<"Ничего" or one question per decision>

Closes #<issue>
```

## Sections

- **Что сделано**: use the `pr` skill's guidance for the Summary view.
- **Проверка**: list actual checks with their scope and outcome. Name a check you did not run,
  a skipped criterion, or a re-run of an unrelated failure.
- **Риск merge**: use the `pr` skill's guidance for Merge Danger.
- **Нужно от владельца**: write what the owner check of `ship` asks the owner to look at or decide. Ask each
  decision as one yes/no question in plain Russian. Add one sentence on what «да» changes: what
  merges, ships or becomes allowed. Name the effect in everyday words.

An earlier supporting PR uses `Part of #<issue>`; the final delivery PR uses `Closes #<issue>`.
