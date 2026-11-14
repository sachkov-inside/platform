# Go-модули Gosu в PostgreSQL image

Дополнительная проверка #2117 после первого production rollout выявила пропуск в собственном
`infra/production/database/gosu/go.mod`. Обновление Gosu до 1.20 и отсутствие Trivy findings
не доказывали актуальность его модулей. Это repository-owned manifest, поэтому ограничение
готового upstream bundle, описанное для BuildKit, здесь не применяется.

## Источники и версии

| Компонент | Первый образ 18.7/2.60 | Обновление | Фактический источник |
|---|---|---|---|
| Gosu source | 1.20, commit 29b939aa5bd4dc588af765b8248f6e39150d2565 | тот же | archive SHA-256 2b70da8a5480fafedc16bb1fc91b572f064d03df736cbd91a616af2f1b66ab51 |
| Компилятор | Go 1.27.4 | тот же | pinned official golang OCI index, ELF build info |
| `github.com/moby/sys/user` | 0.4.1 | 0.5.0 | Go module proxy, stable tag 26.10.2026; go.sum и ELF build info |
| `golang.org/x/sys` | 0.44.0 | 0.50.0 | Go module proxy, stable tag 06.11.2026; go.sum и ELF build info |
| Go language minimum | 1.25.0 | 1.26.0 | требование x/sys 0.50, компилятор остаётся 1.27.4 |

Первичные metadata: [moby/sys/user](https://proxy.golang.org/github.com/moby/sys/user/@latest),
[x/sys](https://proxy.golang.org/golang.org/x/sys/@latest). Их ответы и timestamps сохранены
в свидетельствах сессии; `@latest` в ссылке изменяем, выбранные версии выше зафиксированы.
Обе версии существовали до исходного cutoff аудита. Проверены все собственные Go manifests проекта:
один `go.mod` и соответствующий `go.sum`, два внешних модуля. `go list -m -u -mod=readonly all`
проверяет весь разрешённый граф, а не npm workspace.

Полные PostgreSQL images с новыми модулями собраны на Linux amd64 и arm64 без изменения исходников Gosu.
Во время сборки прошли UID, primary/supplementary groups и оба отрицательных отказа.
ELF metadata обеих архитектур подтвердили user 0.5.0, x/sys 0.50.0 и compiler Go 1.27.4.
`go mod tidy` выполнен на исходниках с проверенным archive hash, не на пустом каталоге manifest.
Старые неиспользуемые sums удалены. Docker продолжает использовать `-mod=readonly` и `GOTOOLCHAIN=local`.

## Совместимость и доставка

Проверка ELF прежнего реального PostgreSQL image подтвердила Go 1.27.4, user 0.4.1 и x/sys 0.44.0.
Условие выбранных новых версий на этом binary дало отказ. Новый image обязан подтвердить обе
версии по ELF metadata и сохранить публичное поведение Gosu: UID, primary/supplementary groups
PostgreSQL, отказ для неизвестного пользователя и неизвестной группы.

Локальные focused foundation/recovery/toolchain contracts: 56 passed. Docker quality и docs:check прошли.
Trivy с DB от 14.11.2026 07:01 UTC распознал в обеих готовых архитектурах 56 OS packages и четыре
Go package entries, findings нет. Версии пакетов ОС amd64 совпадают с прежним image. Это результат
этих артефактов и этой базы, не доказательство отсутствия уязвимостей во всём стеке.

Меняются только модули helper и проверки этих границ. PostgreSQL 18.7, pgBackRest 2.60.0,
private encryption patches, config, data layout и правила cipher остаются прежними.
Изменение Go modules не является RNG failure experiment; ограничение #1627 сохраняется.
Требуются независимые Standards/Spec/security reviews, CI с native amd64/arm64 restore,
затем отдельный production lock, свежий backup/recovery proof и проверка нового image.
Прежний image и native archive сохраняются. До отдельной записи доставки обновление на production
не считается применённым. Применённые результаты фиксируются в PR и production lock.
