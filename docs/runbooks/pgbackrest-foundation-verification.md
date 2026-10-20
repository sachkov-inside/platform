# Проверка кандидата pgBackRest foundation

Подготовка [#1579](https://github.com/sachkov-inside/platform/issues/1579) сохраняет
PostgreSQL 18.4 и использует официальный distribution pgBackRest 2.59.3.
Версии и происхождение задаёт [versions.json](../../infra/production/database/versions.json).
Политика production backup, ключи, stanza и действующие repository этой проверкой не меняются.

## Отдельные доказательства

[Workflow](../../.github/workflows/foundation-recovery.yml) запускает отдельные одноразовые
GitHub-hosted runners `ubuntu-24.04` и `ubuntu-24.04-arm`. Архитектуры проверяются без эмуляции.
Он выбирает только изменения foundation и своих проверок, включая состав merge group.
Общий локальный Compose-стенд не используется. Runtime launcher отказывает на Mac,
self-hosted runner, нелокальном Docker endpoint или daemon с чужими контейнерами/томами.

Для каждой архитектуры создаются только synthetic базы `inside` и `logto`, без сетевого
доступа или опубликованных портов. Проверка включает:

- Версии PostgreSQL, pgBackRest и runtime libpq, выбранный build-time `libpq.pc`, digest
  distribution и бинарника, OpenSSL, ELF PIE/RELRO/NOW/NX stack и stack protector symbol.
- Зашифрованный full backup с `--start-fast`, WAL и fresh restore обеих баз. Отдельный restore к именованной
  точке подтверждает наличие транзакций до неё и отсутствие транзакций после неё.
- Обычную совместимость чтения копии pgBackRest 2.57.0. Legacy writer собирается отдельно
  из замороженного source `9a17509d802f8fa165b5988962f20ae18155fd73`, не из production image.
- Контрольное сравнение ключей на одном неизменном repository: правильный ключ читает
  `backup.info` полностью через `repo-get`, неверный даёт CryptoError либо другие plaintext
  bytes, затем restore обязан отказать именно на decipher/metadata validation. Внешний
  код 75 без соответствующей цепочки ошибки не принимается. Целевой кластер должен
  отсутствовать. Правильный ключ повторно читает тот же plaintext и восстанавливает
  обе базы в тот же target, исключая ошибку прав доступа. Plaintext и subkeys не публикуются.
  У binary metadata readers отключён Docker log driver, чтобы stdout не сохранялся в daemon logs.
- Отказ PITR после удаления необходимого WAL
  только в отдельной копии synthetic repository.
- Неизменность остановленного source volume и исходного repository. Восстановления читают
  repository через read-only mount и пишут в новые собственные тома.
- Реальную очистку ресурсов при успехе, ошибке команды, timeout, SIGTERM и SIGKILL.
  Команды запускаются в собственных process groups с ограниченным завершением всего дерева.
  SIGTERM и SIGKILL прерывают активную команду с дочерним процессом. Для SIGKILL внешний
  supervisor завершает её группу и отдельно восстанавливает очистку по журналу ресурсов.

Потоковое расшифрование может передать байты парсеру раньше проверки padding, поэтому
неверный ключ может дать `FormatError` вместо CryptoError. CBC также может принять padding
при неверном ключе; один успешный `repo-get` с отличающимися bytes не закрывает отрицательный
сценарий. Основание: [cipherBlock.c](https://github.com/pgbackrest/pgbackrest/blob/46cdca625a73403cad4774d97354a1fac1e91e51/src/common/crypto/cipherBlock.c#L183)
и [repo-get](https://pgbackrest.org/command.html#command-repo-get).

Synthetic backup запрашивает немедленный checkpoint через `--start-fast`, чтобы плановый
checkpoint PostgreSQL не превышал ограниченный бюджет теста. Это штатная опция
[pgBackRest](https://pgbackrest.org/user-guide.html); production backup policy не меняется.

Временные каталоги spool/log находятся в tmpfs. Перед командой fixture назначает их
пользователю `postgres`, потому что mount перекрывает владельца из образа. Repository
остаётся read-only при восстановлении.

Секреты синтетической проверки находятся в приватном runner temp и не включаются в artifact.
Общий Docker `prune` не используется. Cleanup проверяет labels и точный journal; недоступность
daemon не считается отсутствием ресурсов. Шаг `always()` повторяет cleanup после прерывания.

## Результаты и ограничения

Artifact `foundation-recovery-<architecture>-<attempt>` содержит квитанции обычного
encrypted recovery и legacy compatibility. Проверять нужно source SHA, image ID, архитектуру,
фактические результаты шагов workflow и успешную очистку. Одна квитанция без успешного
задания не доказывает весь набор проверок. Отсутствующая квитанция не считается успехом.

Это подготовленный исполняемый комплект. До реального запуска он не является доказательством
прошедшего encrypted backup, PITR, native build или process cleanup.

Эксперимент с отказом криптографического RNG не выполняется. Его ранее остановленный критерий
остаётся открытым и в квитанции явно обозначен `rngFailureVerified=false`.
[Upstream evidence](../research/2026-10-20-pgbackrest-upstream-verification.md) не заменяет его
или проверку собственного образа. Обновление binary не заменяет исторические stanza subkeys.

Для применения кандидата на production отдельно нужны все обязательные gates #1579,
принятие подготовленного HIGH результата, свежий backup/isolated restore, план сохранения
новых записей при rollback и объявленное окно. Используется существующий
[foundation runbook](production-foundation.md). Этим комплектом production не обновляется.
