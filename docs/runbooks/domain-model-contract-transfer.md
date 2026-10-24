# Локальная проверка передачи доменной модели

Проверка запускает отдельно собранные Backend, Web и Telegram из двух изолированных checkout.
Она использует синтетические данные, отдельный PostgreSQL 18.4 и локальные identity/provider doubles.
Она не является production rollout. Предыдущие строгие читатели отвергают новые значения,
поэтому проверяется ограниченная несовместимая механическая передача с остановкой старых
потребителей, разрешённая [спецификацией](../specifications/domain-model-refactoring-v1.md).
Rolling compatibility этим результатом не заявляется.

## Подготовка артефактов

Используйте закреплённые Node и pnpm, отдельный frozen install и собственные `node_modules` в каждом
checkout. Старый checkout должен оставаться на выбранном доверенном историческом commit.
Не меняйте исходники или зависимости старого приложения для прохождения новой схемы.
Для каждой версии запишите commit, tree, команды и их реальные exit codes. Все исходники должны
быть committed, а tracked tree оставаться чистым от начала build до capture и запуска.

В каждом checkout соберите все три приложения отдельно. Удаление ниже относится только к
собственным generated outputs этой проверки. Удаление incremental cache обязательно: `tsc` может
завершиться успешно без создания удалённого `dist`, если сохранился старый build info.

```sh
pnpm install --frozen-lockfile
rm -rf apps/backend/dist apps/telegram/dist
rm -f apps/backend/tsconfig.production.tsbuildinfo
bash scripts/heavy-check.sh pnpm --filter @inside/backend build:production
bash scripts/heavy-check.sh pnpm --filter @inside/web build
bash scripts/heavy-check.sh pnpm --filter @inside/telegram build
```

Старый checkout может предшествовать этому runbook. Команды запускаются из текущего checkout
с абсолютным путём его `scripts/heavy-check.sh`, сохраняя cwd старого checkout.
После успешных builds используйте текущий capture helper. Задайте `ARTIFACTS` как новую
существующую пустую директорию вне tracked source, `LEGACY` как старый checkout, `CURRENT` как
текущий checkout и обе переменные `*_SHA` как commits, записанные до builds:

```sh
node scripts/fixtures/domain-contract-transfer/capture.mjs "$LEGACY" "$ARTIFACTS" legacy "$LEGACY_SHA"
node scripts/fixtures/domain-contract-transfer/capture.mjs "$CURRENT" "$ARTIFACTS" current "$CURRENT_SHA"
```

Capture отказывается перезаписывать прежние evidence, проверяет чистый source и сохраняет
commit/tree, Node version и hashes всех обычных файлов трёх outputs. Hash вычисляется по
отсортированным POSIX paths, `NUL`, SHA-256 bytes файла и `LF`. Symlinks сохраняются при копировании,
но не входят в hash обычных файлов. Built Backend и Telegram выполняются в исходном собственном
checkout, с его собственным разрешением зависимостей. Копирование старого `dist` рядом с новыми
`node_modules` не воспроизводит старого строгого читателя. Web запускается из отдельной временной
копии standalone, с явно записанной синтетической runtime identity; исходный build не меняется.

## Выполнение

Убедитесь, что localhost port `18514` свободен и выделен этой проверке. Identity и provider doubles
получают собственные случайные loopback ports. Docker нужен для отдельного закреплённого
PostgreSQL, Compose и существующий local stand не используются.

```sh
DOMAIN_TRANSFER_LEGACY_ROOT="$LEGACY" \
DOMAIN_TRANSFER_ARTIFACTS="$ARTIFACTS" \
DOMAIN_TRANSFER_EVIDENCE_DIRECTORY="$EVIDENCE" \
DOMAIN_RESTORE_EVIDENCE_DIRECTORY="$EVIDENCE" \
bash scripts/heavy-check.sh node scripts/fixtures/domain-contract-transfer/run.mjs
```

Helper проверяет source/build hashes перед запуском. Он исполняет реальные built owning
capabilities Backend и Telegram в отдельных процессах и настоящий Web standalone с BFF и
session cookie. Внешние identity/provider responses синтетические. Миграции, Prisma/Kysely,
receipt storage, strict parsing, Task validation и HTTP BFF выполняются реальным приложением.

Последовательность обязательна:

1. Старые built providers создают Task, Material Source и communication receipt в реальных базах.
   Старые читатели принимают исходные данные и отклоняют несовместимые nullable даты, новые source
   enums, неизвестную сумму частичного возврата, Task result 16000 и definition между 128/130 KiB.
2. Все старые процессы завершаются. Полные custom-format архивы обеих баз восстанавливаются в
   новые пустые базы. Все tables и sequence state совпадают. Dispatch остаётся удержанным.
3. Текущие built migrators обновляют исходные и восстановленные базы. Первоначальные Task и
   Source receipts восстанавливаются по исходным actor/key/body; старый communication command
   отвергается, его immutable receipt читается отдельной текущей historical capability.
4. Текущие Backend/Web/Telegram readers принимают новые контракты. Только после их готовности
   выполняется текущая canonical communication mutation. Старые бизнес-алиасы не включаются.

`evidence.json` содержит matrix, manifests, child exit codes, последовательность drain/backup/
restore/readiness и cleanup. Отдельные logs сохраняют результат каждого built процесса.
Успешное завершение требует закрытия всех child processes, pools, doubles и собственного контейнера.

Эта проверка дополняет [полное mixed-data восстановление](domain-model-restore.md), где реальные
recovery owners проверяют pending one-time операции, неизвестные внешние результаты и Telegram
receipts после двух проходов и восстановления recovered archive. Утрата post-backup receipts
не даёт права повторно отправлять деньги или сообщения: legacy restore остаётся удержанным до
операторской сверки. Ни один из этих локальных результатов не разрешает production recovery,
публикацию новой юридической редакции или открытие продаж.
