# Отметки изучения материалов и прогресс серий

Статус: модель и минимальный переключатель согласованы владельцем 2026-09-06; пользовательская интеграция поставляется в #329.
Delivery: [Specification #323](https://github.com/sachkov-inside/platform/issues/323).
[ADR 0017](../adr/0017-reading-state-and-transition-history.md) фиксирует выбор состояния и истории.
[Персональная главная](personal-home.md) и [аналитика автора](../product/author-analytics-plan.md)
поставляются отдельно.

## Пользовательский результат

Авторизованный человек вручную отмечает доступный материал прочитанным, просмотренным или
изученным и может снять отметку. Это самооценка ознакомления, не проверка знаний. На Reader любого
формата есть понятное действие. На карточках Library, Topic, Series и Home виден тот же результат.
Отдельная кнопка на каждой карточке не обязательна: это решает visual proof.

- Принятый в #328 переключатель сохраняет подпись: Text «Прочитано», Video «Просмотрено»,
  Guide/остальные «Изучено». Пустой круг меняется на галочку; повторное нажатие снимает отметку.
  Это presentation mapping существующих Format, не новые состояния хранения.
- Состояние после действия явно обозначено; доступна команда «Снять отметку».
- Anonymous получает предложение войти для сохранения; открытые материалы доступны без входа.
- Free non-member пользуется отметками открытых материалов наравне с подписчиком.
- Открытие, scroll, длительность чтения и конец видео не меняют ReadingState автоматически.
- Pending/error/retry/conflict и keyboard/screen-reader состояния входят в результат. Ошибка
  сохранения не должна оставлять ложное подтверждение; optimistic UI откатывается/сверяется.

## Владение и устойчивые ссылки

ReadingActivity — Module существующего backend; создаёт схему PostgreSQL `reading_activity`
при первой migration. Accounts владеет identity, Materials/ContentLibrary — опубликованным
составом, ContentAccess — разрешением доступа, Videos — VideoPlaybackProgress.

Внешние AccountId/MaterialId хранятся как opaque identifiers. Согласно ADR 0003 нет cross-schema
SQL, views или foreign keys; caller использует публичные interfaces владельцев. Внешний
accountId не принимается на доверии от browser: текущий Account разрешается из trusted session.

Смена профиля, Telegram link или окончание Membership не сбрасывает отметки. Публичные Material
responses/caches не содержат персональные поля; personal reads изолированы по Account. Logout
очищает personal browser cache. ReadingState никогда не даёт право читать body/resources.

Mark-read требует актуального разрешения ContentAccess на опубликованный Material. Снятие своей
существующей отметки разрешено после окончания Membership, включая скрытый Material, по opaque ID;
ответ не раскрывает его body или непубличные metadata. Чтение собственных состояний не раскрывает
контент: публичные карточки строятся только из разрешённых published projections. Запрос другого
Account отклоняется. Для новой mark-read команды контрольная точка доступа — успешная проверка
ContentAccess после сериализации пары, с проверкой актуальности Material/version и validUntil
по существующему контракту. Обнаруженная к этой точке смена версии/доступа даёт отказ/conflict без
перехода. Изменение доступа после этой проверки может опередить commit отметки: это допустимо,
отметка не доставляет защищённые bytes и не даёт доступ. Глобальная атомарность с unpublish/revoke
других Modules не обещается; следующий protected read заново авторизуется. Receipt replay
возвращает прошлый результат без повторного создания отметки или доставки body.

## Текущее состояние

`material_states` имеет primary key `(account_id, material_id)`:

| Поле | Значение |
|---|---|
| account_id, material_id | UUID внешних устойчивых identities |
| is_read | Текущая ручная отметка |
| read_at | Серверное время действующей отметки; null при false |
| version | Монотонная версия изменения этой пары |
| updated_at | Серверное время последнего перехода |

Отсутствие строки эквивалентно false/version=0. Не создавать произведение Accounts × Materials.
При первом реальном переходе version=1. CHECK связывает is_read и nullability read_at; version>0.
Снятие отметки сохраняет строку и её version, чтобы старый запрос не оживил сброшенное состояние.
Read-time counters и last-open не обновляют эту version.

## История переходов и повтор запросов

`events` хранит event_id, account_id, material_id, event_type (`material_marked_read` либо
`material_marked_unread`), state_version, occurred_at, command_id, schema_version.
Event ID уникален; `(account_id, material_id, state_version)` уникальна для переходов. Время задаёт
сервер; порядок конкретной пары определяет version, не часы браузера. Payload не содержит email,
Telegram ID, body, tokens или storage keys. Индекс `(account_id, occurred_at, event_id)` поддерживает
bounded историю; дополнительные аналитические индексы вводятся по фактическому потребителю.

Mutation задаёт желаемое boolean состояние, expectedVersion и commandId; это не toggle. Durable
`commands` с уникальным `(account_id, command_id)` хранит fingerprint операции/Material/value/version
и результат успешной обработки, включая no-op. Алгоритм:

1. Проверить trusted Account и форму команды. Найденный receipt с тем же fingerprint возвращает
   сохранённый outcome без новой записи; другой payload с тем же ID даёт conflict. Receipt не
   утверждает, что старый outcome всё ещё current: UI получает/перечитывает актуальную version.
2. Для новой команды проверить право операции и сериализовать конкурирующие изменения пары,
   включая случай отсутствующей строки; выбрать конкретный PostgreSQL способ в implementation.
3. Проверить expectedVersion; stale version даёт conflict с безопасным current state. Повтор уже
   успешной команды определяется до stale check. Две разные команды одной version не затирают друг друга.
4. При изменении записать state и ровно один event; при совпадающем значении не менять version,
   timestamps и не создавать event. Сохранить receipt. Commit этих записей атомарен.
5. Ошибка любой записи откатывает всё. Повтор после потери ответа не увеличивает счётчики.

Успешные receipts сохраняются вместе с Account на этом этапе; автоматический TTL пока отсутствует.
При будущей retention policy нельзя допустить повторного применения старой команды: потребуется
явная граница replay либо минимальный tombstone. История переходов append-only для обычных
операций, но не отменяет удаления/обезличивания данных Account через отдельный lifecycle.
Отсутствующий Account после удаления не восстанавливается из запоздавшего события.

Чтение использует material_states, а не replay истории. No-op и повтор не являются повторным
изучением. Будущая аналитика различает число событий, уникальные пары, первое завершение и
текущее число отметок. История начинается с внедрения; прошлые действия не выдумываются.

## Серия

Series progress — вычисляемое представление, не отдельное mutable completion состояние.
Состав берётся через ContentLibrary/Materials interface; personal flags — через ReadingActivity.
Один Material засчитывается во всех Series, где опубликован, независимо от точки входа.

- total = число текущих опубликованных материалов в Series; read = число их отметок true.
- allRead = total>0 и read=total. Показывать «Изучено N из M»; процентов и оценки усвоения нет.
- Закрытые Published материалы входят в denominator, даже если Account сейчас без Membership.
- Draft/Unpublished не входят; их личные отметки остаются. Republish возвращает прежнюю отметку.
- Добавление даёт, например, 5 из 6 вместо 5 из 5; удаление из серии и reorder не меняют ReadingState.
- Пустая серия не завершена. Archive не удаляет сохранённые факты; discovery следует ContentLibrary.
- Изменение title/body/contentVersion не сбрасывает отметку. contentVersion не учебная редакция.
- Внутри одного ответа numerator и denominator относятся к одному полученному набору Material IDs.
  Повторное изменение состава отражается при следующем запросе; не обещать глобальный snapshot
  между разными HTTP запросами. Большая Series читается bounded контрактом владельца, без N+1.

Историческое достижение «завершил серию на дату» не входит. Для него понадобится отдельный факт со
снимком состава; из одних reading events нельзя восстановить прежнюю изменяемую Series.

## Малый interface и проверка

Interface ReadingActivity предоставляет setReadingState, bounded getReadingStates для набора IDs
и private bounded историю переходов только при реальном UI consumer. Recent-open history из
соседней спецификации — самостоятельный факт, не read_at. Точные REST paths/codecs вводит backend
child в source schemas с генерацией OpenAPI/Web client, без ручного редактирования generated files.

Backend child владеет migrations, command semantics и real-PostgreSQL tests с двумя connections:
rollback event/state/receipt, concurrent first write, replay после последующего unmark, mismatch,
stale no-op, same-value no-event. Обязательны access races, Account isolation, expiry, shared
Material/two Series, composition changes и empty Series. Ownership guardrail добавляет passing
Module case и forbidden cross-schema fixture при появлении схемы; до кода это fitness candidate.

Visual proof child согласует состояния. Integration child соединяет реальный transport,
presentation и invalidation, проверяет mobile/desktop, reload, два browser contexts, разные форматы
и маршруты, non-member/member/expired/anonymous; получает production visual GO. Все children
проходят применимые pnpm checks и Standards/Spec review. Done означает пользовательскую вертикаль,
а не только таблицы или Storybook. Merge/deploy отдельно.

## Задачи поставки

- [#326](https://github.com/sachkov-inside/platform/issues/326) — Следующие исполнители получают согласованную модель прогресса и независимые задачи персональной главной и аналитики.
- [#327](https://github.com/sachkov-inside/platform/issues/327) — Backend надёжно сохраняет личные отметки и возвращает их для материалов и серий.
- [#328](https://github.com/sachkov-inside/platform/issues/328) — Владелец видит и принимает понятное действие для каждого формата материала.
- [#329](https://github.com/sachkov-inside/platform/issues/329) — Пользователь отмечает и снимает отметку в реальном приложении, а результат согласован на всех поверхностях.
