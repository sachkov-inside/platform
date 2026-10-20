# pgBackRest 2.59.3: происхождение исправления и границы проверки

Исследование к [#1579](https://github.com/sachkov-inside/platform/issues/1579), 20.10.2026.
Основа проекта: `9a17509d802f8fa165b5988962f20ae18155fd73`.
Проверены первичные источники, исходный код и метаданные upstream CI. Сборки, Docker,
эксперименты с отказами и операции с production в рамках этого исследования не выполнялись.

## Что установлено

Официальное предупреждение от 04.10.2026 относится к версиям до 2.59.3. При ошибке получения
случайных данных OpenSSL программа могла записать слабые подключи или соли, не сообщив об
ошибке. Это условная уязвимость, а не доказательство слабых ключей конкретного репозитория.
Незашифрованные репозитории не затронуты. Подключи stanza создаются один раз, поэтому замена
бинарника сама по себе их не заменяет. Если слабость подключей установлена, upstream требует
новый репозиторий и stanza с сохранением старого репозитория на срок нужных копий. После
обновления также предлагается новая полная копия, поскольку последующие дифференциальные и
инкрементальные копии используют подключ полной копии.
[Официальное предупреждение](https://pgbackrest.org/news.html#weak-encryption-subkeys-and-salts).

Фактическое исправление находится в commit
[`47ed78f8d54a44466a872852939edc0273172bf1`](https://github.com/pgbackrest/pgbackrest/commit/47ed78f8d54a44466a872852939edc0273172bf1).
В исходнике релиза `cryptoRandomBytes()` проверяет результат `RAND_bytes()` и передаёт неуспех
в `cryptoError()`, который выбрасывает `CryptoError`. Это подтверждает наличие проверки в
исходном коде. Оно не доказывает поведение нашего собранного бинарника при отказе источника
случайности.
[Исходник релиза, строки 19–41 и 68–80](https://github.com/pgbackrest/pgbackrest/blob/46cdca625a73403cad4774d97354a1fac1e91e51/src/common/crypto/common.c#L19).

## Точная привязка релиза

Метаданные GitHub API получены 20.10.2026. Релиз отмечен как immutable, опубликован
`2026-10-04T09:02:09Z`.
[Релиз](https://github.com/pgbackrest/pgbackrest/releases/tag/release/2.59.3),
[первичные метаданные](https://api.github.com/repos/pgbackrest/pgbackrest/releases/tags/release%2F2.59.3).

| Объект | Значение |
| --- | --- |
| Tag | `release/2.59.3` |
| Release source | `46cdca625a73403cad4774d97354a1fac1e91e51` |
| Distribution asset | `pgbackrest-2.59.3.tar.gz`, 1 165 978 байт |
| SHA-256 distribution asset | `14037901db002e5536a948bf9f0fc0ff6cde31f4e675d3e9b46f129071bf2e5f` |
| SHA-256 файла `.sha256sum` | `00462142968dc1a53b0398500accfd9a75413384385c29cd4f92c1fc4021d143` |

Последняя строка является хешем файла с контрольной суммой, а не второй суммой архива.
Сами байты архива здесь не скачивались и повторно не хешировались. Приведённые значения
прочитаны из `assets[].digest` API. Официальная инструкция выпуска требует публиковать
distribution tarball из успешного CI на точном release commit.
[Инструкция выпуска на этом commit](https://github.com/pgbackrest/pgbackrest/blob/46cdca625a73403cad4774d97354a1fac1e91e51/doc/RELEASE.md#L128).

Релиз 2.59.3 содержит ещё исправление чтения зашифрованных info/manifest файлов,
[`2def063e06c6f0b7e137309c7ed0d7631a42f6cf`](https://github.com/pgbackrest/pgbackrest/commit/2def063e06c6f0b7e137309c7ed0d7631a42f6cf).
Поэтому проверять только изменение номера версии или отдельную строку RNG недостаточно для
утверждения о происхождении полного release source.

На дату исследования upstream уже выпустил 2.60.0 (18.10.2026). В этой заметке 2.59.3
рассматривается как версия с нужным исправлением, не как последняя доступная версия.
Выбор другой версии требует отдельной оценки изменений.
[Новости upstream](https://pgbackrest.org/news.html).

## Что действительно прошло у upstream

API вернул один запуск для точного release source:
[`test`, run `37185967083`](https://github.com/pgbackrest/pgbackrest/actions/runs/37185967083),
`head_sha=46cdca625a73403cad4774d97354a1fac1e91e51`, `event=push`, `run_attempt=1`,
`created_at=2026-10-04T07:30:05Z`, `status=completed`, `conclusion=success`.
Все 31 job этого запуска имеют `conclusion=success`.
[Runs API](https://api.github.com/repos/pgbackrest/pgbackrest/actions/runs?head_sha=46cdca625a73403cad4774d97354a1fac1e91e51&per_page=100),
[Jobs API](https://api.github.com/repos/pgbackrest/pgbackrest/actions/runs/37185967083/jobs?per_page=100).

| Наблюдаемое подтверждение | Проверенная граница |
| --- | --- |
| [`arch / aarch64`, job `111387813975`](https://github.com/pgbackrest/pgbackrest/actions/runs/37185967083/job/111387813975) | Нативный runner `ubuntu-22.04-arm`; workflow задаёт C unit tests с valgrind. Не проверка нашего ARM-образа |
| [`linux / test`, job `111387814191`](https://github.com/pgbackrest/pgbackrest/actions/runs/37185967083/job/111387814191) | Integration suite `u22` на runner `ubuntu-22.04`. Не наш production image |
| [`dist / build (alpine:3.21)`, job `111388018191`](https://github.com/pgbackrest/pgbackrest/actions/runs/37185967083/job/111388018191) | Сборка distribution tarball и smoke на Alpine runner-платформы. Не приравнивается к нашему foundation image |
| [`dist / build (alpine:3.24)`, job `111388018181`](https://github.com/pgbackrest/pgbackrest/actions/runs/37185967083/job/111388018181) | Та же проверка на другой Alpine |

Назначение job подтверждено неизменяемыми файлами
[`test-arch.yml`](https://github.com/pgbackrest/pgbackrest/blob/46cdca625a73403cad4774d97354a1fac1e91e51/.github/workflows/test-arch.yml),
[`test-linux.yml`](https://github.com/pgbackrest/pgbackrest/blob/46cdca625a73403cad4774d97354a1fac1e91e51/.github/workflows/test-linux.yml)
и [`test-dist.yml`](https://github.com/pgbackrest/pgbackrest/blob/46cdca625a73403cad4774d97354a1fac1e91e51/.github/workflows/test-dist.yml).
Метаданные и определения workflow прочитаны, полный журнал каждого теста не скачивался.
Наличие тестового изменения в fix commit подтверждено историей upstream; отдельный
сценарий отказа здесь не изучался и не запускался. Общий GREEN upstream не заменяет
обязательные проверки проекта.

Особенно важно ограничение `test/smoke.py`: он создаёт отдельный POSIX-репозиторий и кластер
с приватным Unix socket, выполняет full и incremental backup, переключение WAL,
восстановление и сравнение количества строк. Его конфигурация не включает `repo1-cipher-type`
и `repo1-cipher-pass`; restore не задаёт целевую точку восстановления. Поэтому этот smoke
не является доказательством encrypted backup или PITR до выбранной точки.
[Проверенный исходник smoke](https://github.com/pgbackrest/pgbackrest/blob/46cdca625a73403cad4774d97354a1fac1e91e51/test/smoke.py#L265).

## Обычная проверка сборки и восстановления

Upstream предусматривает сборку официального distribution tarball через Meson и Ninja,
а затем `meson test -C build --suite smoke -v`. Это обычная проверка сборки, независимая
от каких-либо экспериментов с отказами. Архив включает сгенерированные исходники;
GitHub source archive и distribution asset нельзя молча считать одним артефактом.
[Проверенный release workflow](https://github.com/pgbackrest/pgbackrest/blob/46cdca625a73403cad4774d97354a1fac1e91e51/.github/workflows/test-dist.yml#L124).

Для будущего результата нашего образа на `linux/amd64` и `linux/arm64` нужны отдельные
записи происхождения: точный source hash и asset checksum, base image digest, архитектура
хоста и бинарника, версия OpenSSL, image digest, команды и действительные exit codes.
Запуск чужой архитектуры под эмуляцией не следует называть нативным. Это критерии
доказательности для последующей проверки, а не уже полученный результат.

Официальные параметры шифрования позволяют задать `aes-256-cbc` и отдельную passphrase
репозитория. Шифрование синтетической копии и WAL проверяется обычным восстановлением
синтетических данных из отдельного зашифрованного репозитория. Доказательство должно
фиксировать выбранную конфигурацию и успешное чтение копии и WAL, не публикуя пароль
или подключи.
[Repository cipher options](https://pgbackrest.org/configuration.html#section-repository/option-repo-cipher-type).

Для PITR официальное руководство использует restore к выбранной временной точке, с WAL
для воспроизведения изменений. В синтетическом результате следует отдельно подтвердить
наличие транзакции до выбранной точки и отсутствие транзакции после неё. Успешное обычное
восстановление последней копии это различие не доказывает.
[Point-in-Time Recovery](https://pgbackrest.org/user-guide.html#pitr).

## Незакрытые границы #1579

В исходнике проекта на указанной основе всё ещё закреплён пакет `pgbackrest=2.57.0-r0`.
[Production database Dockerfile](../../infra/production/database/Dockerfile).
Этот факт не сообщает, какие подключи были созданы при работе production, и не доказывает
их слабость. Их состояние в этом исследовании не проверялось.

Источники подтверждают исправление и успешный upstream CI. Они не подтверждают сборку и
encrypted backup/WAL/PITR нашего нового amd64/arm64 image, ротацию существующих подключей
или обновление production. Ранее полученное доказательство Stage A другой сессии не
перепроверялось и не объявляется собственным результатом.

Предыдущая автоматическая проверка безопасности остановила Stage B с экспериментом отказа
RNG. Это исследование его не возобновляет, не предлагает обход и не меняет обязательные
критерии приёмки. Если такой критерий остаётся обязательным и не имеет допустимого
доказательства, его нужно явно оставить незакрытым. Обычные успешные backup/restore и
ссылка на upstream CI не дают основания закрыть его молча.
