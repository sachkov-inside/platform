#!/usr/bin/env bash
set -euo pipefail

# Branch experiments keep their red run, but only main failures enter the product tracker.
if [[ "${GITHUB_REF:?GITHUB_REF is required}" != "refs/heads/main" ]]; then
  exit 0
fi

: "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"
: "${GITHUB_SERVER_URL:?GITHUB_SERVER_URL is required}"
: "${GITHUB_RUN_ID:?GITHUB_RUN_ID is required}"
: "${GITHUB_SHA:?GITHUB_SHA is required}"

title="Nightly full-stack smoke: падение на main"
run_url="$GITHUB_SERVER_URL/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID"
body_file=$(mktemp)
trap 'rm -f "$body_file"' EXIT
cat >"$body_file" <<EOF
Ночной сквозной прогон на main упал. Проверьте шаг, завершившийся ошибкой, до следующего выпуска.

- Прогон: $run_url
- Коммит: $GITHUB_SHA
- Диагностика: артефакт nightly-fullstack-diagnostics в этом прогоне; хранится семь дней.

Если MCP отклонил пробу, сообщение называет инструмент и путь поля, например metadata.difficulty.
Если браузер увидел недоступную страницу, проверьте логи API/Web, trace и runner-load.txt.
TimeoutError может означать истечение бюджета API-запроса или ожидания Playwright; определите источник по стеку.
Высокая нагрузка сама по себе не доказывает причину падения.
Не повышайте бюджеты и не повторяйте тесты для получения зелёного результата. Найдите причину падения.

Создано механизмом #589. Повторные падения обновляют эту Issue; исправление подтверждается зелёным прогоном на main.
EOF

issue=$(gh issue list --repo "$GITHUB_REPOSITORY" --state open --limit 100 \
  --search "\"$title\" in:title" --json number,title \
  --jq ".[] | select(.title == \"$title\") | .number" | head -n 1)
if [[ -n "$issue" ]]; then
  gh issue edit "$issue" --repo "$GITHUB_REPOSITORY" --body-file "$body_file"
else
  gh issue create --repo "$GITHUB_REPOSITORY" --title "$title" \
    --label needs-triage --assignee KirillSachkov --body-file "$body_file"
fi
