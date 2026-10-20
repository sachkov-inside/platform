# Reader: сравнение действий, #1591

Статус: **владелец принял вариант A**. Решение записано после просмотра прототипа.
Production implementation, PR, merge и публикация не выполнялись.

Задача: [#1591](https://github.com/sachkov-inside/platform/issues/1591).
Ветка: `prototype/1591-reader-actions`.
Проверенный код: `69ac3cf6f02353a060e25471762329f6af7e97b2`.
Base и trusted policy revision: `2f5300026c5a3e946f30596262a02747c6f48827`.
Перед изменениями выполнен fetch и проверены открытые PR: #1339 затрагивает действия Reader,
но не является источником этой работы. Остальные PR, worktrees и listeners сохранены.

## Сравнение

- [A · Подписи](http://localhost:6019/?path=/story/prototypes-1591-reader-actions--a-labels).
  На широком экране все действия имеют текст. Рекомендация для первого просмотра:
  этот вариант проще оценить без знания значков.
- [B · Компактно](http://localhost:6019/?path=/story/prototypes-1591-reader-actions--b-compact).
  Сохранение и отправка всегда показаны значками; текст остаётся у изучения и переходов.

Переключатель A/B находится над Reader и сохраняет состояния при сравнении.
На планшете подписи сохранения и отправки скрыты у обоих вариантов.
При ширине контейнера до 390 px скрыта подпись изучения, до 290 px также подписи переходов.
При 390 px экрана «Назад» и «Дальше» ещё видны. При 320 px остаются доступные значки.
Зоны нажатия во всех проверенных панелях не меньше 44×44 px.

Обе панели показывают «Назад», сохранение, изучение и отправку слева, «Дальше» справа.
Кнопки «Нравится» нет. Сохранение и изучение синхронны сверху и снизу.
Флажок «Есть следующий шаг» убирает «Дальше» из обеих экспериментальных панелей.
Сообщение о Back, Next или Share появляется непосредственно под нажатой панелью.

## Мобильный просмотр A

По просьбе владельца добавлена отдельная [мобильная история A](http://localhost:6019/?path=/story/prototypes-1591-reader-actions--a-labels-mobile).
Она открывает тот же A в области 390×844 px, в том числе при просмотре с desktop.
В браузере подтверждена ширина iframe 390 px без горизонтального переполнения.
Дополнительные [снимок верха](a-mobile-review-top.png) и [снимок низа](a-mobile-review-bottom.png) показывают принятую панель в этом размере.
Проверки типов и локальный lint прошли. Дизайн и действия A не менялись.

## Ограничения

Это Storybook-only proof с React state. Перезагрузка сбрасывает состояния.
Back и Next показывают результат действия, но не выполняют переход.
Share показывает демонстрационное подтверждение; clipboard, native share и отправка не вызываются.
Account shell получает fixture response. Реальных bookmark/progress writes нет.
Длинный текст взят из существующего учебного примера Storybook и повторён для проверки прокрутки.
Это не редакция материалов курса.

Используются production `ReaderFrame`, `MaterialReaderHeader`, `MaterialBodyView`, `Button`,
существующие shell, course fixture, значки и токены. Production-файлы не изменены.
Боковая навигация, выбор главы и существующий мобильный dock остаются production fixture.
Флажок наличия следующего шага управляет только экспериментальными панелями, не этим dock.
В рамках #1490 ничего не реализовано. Общий stand, миграции и pending stand-main refresh не затронуты.

Четыре частных скриншота владельца просмотрены и скопированы только в игнорируемую
`.reports/1591/private-references/`. Они не входят в Git и не обслуживаются Storybook.
Картинки ниже сделаны из синтетического прототипа.

## Проверки, 20.10.2026

Команды завершились с exit code 0:

- `pnpm --filter @inside/web exec tsc --noEmit --pretty false`.
- `pnpm exec oxlint --deny-warnings apps/web/src/storybook/reader-actions-experiment.stories.tsx`.
- `pnpm exec prettier --check apps/web/src/storybook/reader-actions-experiment.stories.tsx apps/web/src/storybook/reader-actions-experiment.module.css`.
- `pnpm --filter @inside/web guardrails`, включая negative guardrails.
- Браузерный proof ниже, через собственную сессию `playwright-cli -s=platform-1591`.

[Результаты браузера](browser-results.json) относятся к обоим вариантам при
1440, 1024, 820, 390 и 320 px, высота 1000 px. Во всех десяти случаях:

- document и обе панели имеют `scrollWidth === clientWidth`;
- кнопки имеют доступные имена и размер не меньше 44×44 px;
- Tab переводит фокус с Back на Save, фокус виден, Enter переключает Save;
- Save и Studied переключаются в обе стороны с синхронизацией верхней/нижней панели;
- Share даёт feedback, включая отдельную проверку сообщения у нижней панели;
- при снятом флажке Next отсутствует в обеих панелях, Back остаётся доступен;
- при reduced motion у действия нет animation или transition;
- axe WCAG 2 A/AA и WCAG 2.1 A/AA не нашёл нарушений в story content;
- браузер не отправил ни одного API write request.

Просмотрены снимки desktop, intermediate и mobile, включая низ длинной страницы.
Первая итерация выявила feedback только наверху, исправлено и подтверждено вторым прогоном.
Есть один некритичный 404 для `favicon.ico`; ошибок рендера на финальном прогоне нет.
Impeccable detector дал одно advisory: `0.9375rem` вне общей type ramp.
Размер сохранён из production Reader article, чтобы не менять типографику эксперимента.

[Desktop A](a-desktop.png), [desktop B](b-desktop.png),
[mobile top](mobile-top.png), [mobile bottom](mobile-bottom.png).
Снимки показывают viewport, а не весь длинный документ.
Полные десять пар локальных снимков сохранены в `.reports/1591/`.

Воспроизведение из корня репозитория при работающем Storybook на 6019:

```bash
mkdir -p .reports/1591
playwright-cli -s=platform-1591 open 'http://localhost:6019/iframe.html?id=prototypes-1591-reader-actions--a-labels&viewMode=story'
playwright-cli -s=platform-1591 run-code --filename=docs/evidence/issue-1591/browser-check.cjs
playwright-cli -s=platform-1591 close
```

## Классификация

Два независимых read-only worker выполнили provisional и actual-change assessment по
`classify-change`. Trusted policy: `docs/agents/change-risk.md` в base revision выше.
Оценённый staged код совпадает с code commit выше. Финальный прогон после последней
правки завершён успешно; свидетельства выше дополняют проверенные workers условия.

- Risk worker: **medium**, ограниченное обратимое интерактивное поведение, без high-risk
  triggers. Security review не нужен: права, данные, секреты и trust boundaries не меняются.
- Owner participation worker: для подготовки и показа дополнительное разрешение не нужно.
  Выбор направления требуется перед promotion. Выбор прототипа сам по себе не назначает implementation.
- Противоречий нет. Policy не изменена. По prototype override в `WORKFLOW.md` full product CI,
  independent finish review и PR не являются prerequisites preview.

## Решение владельца

Владелец в этой сессии сообщил: «принимаю A».
Принят вариант **A · Подписи** из code commit
`69ac3cf6f02353a060e25471762329f6af7e97b2`, показанный в preview выше.
Это направление с подписями на широком экране, сокращением до значков на узком
и повторением панели после длинного текста. Вариант B остаётся историей сравнения.
Дополнительных изменений к A владелец не указал.

Выбор направления выполнен. Production implementation не назначена этим решением.
Следующий шаг, отдельное поручение на внедрение выбранного A с production visual gate.
Принятие прототипа не заменяет проверку и принятие точной production-реализации.

## Сохранённый preview и ресурсы

Владелец ресурса: эта независимая сессия #1591. Сервер оставлен для просмотра.
Порт `6019`, PID `79792`, parent PID `79719` на момент проверки.
Cwd процесса: worktree `reader-actions-experiment`, подкаталог `apps/web`.
Source: code commit выше, два Storybook-файла. Запуск не использует Compose или общий stand.

Команда перезапуска из корня этой ветки, если порт свободен:

```bash
pnpm --filter @inside/web exec storybook dev --port 6019 --ci --no-open
```

Перед остановкой сверить PID и cwd через `lsof -a -p 79792 -d cwd`.
После окончания owner review этот собственный сервер можно остановить `kill -TERM 79792`.
Если PID изменился, сначала определить процесс на 6019 и его cwd; чужой listener сохраняется.

Собственная браузерная сессия закрыта. Применён `session-cleanup`: disposable browser освобождён,
сервер, ветка, worktree и локальные evidence намеренно сохранены для owner review.
Чужие ресурсы не удалялись. Удалённая ветка не опубликована.
