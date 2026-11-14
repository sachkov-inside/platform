# Docker Compose при доставке #2117

Публикация Platform v81, run [43589600437](https://github.com/sachkov-inside/platform/actions/runs/43589600437),
остановилась до создания immutable Release. Образы опубликованы как промежуточные результаты;
они не дают разрешения на deployment без успешной финализации.

Фактический GitHub runner `ubuntu24/20261111.370` содержит Docker Compose 2.38.2,
Docker Engine/Client 28.0.4. Источник: [ведомость образа runner](https://github.com/actions/runner-images/blob/ubuntu24/20261111.370/images/ubuntu/Ubuntu2404-Readme.md).
Production использует Ubuntu package `docker-compose-v2 2.40.3+ds1-0ubuntu1`, plugin
`/usr/libexec/docker/cli-plugins/docker-compose`, и Ubuntu Docker Engine 29.1.3.

## Воспроизведение

Официальный Linux ARM64 Compose 2.38.2 проверен по SHA-256
`4d0f7678dd3338452beba4518e36a8e22b20cad79ba2535c687da554dc3997fb`.
На том же production Compose input, без сети и Docker socket, он возвращает
`invalid spec ... too many colons`: обязательная переменная `${PLATFORM_CONFIG_DIR:?...}`
в коротком bind mount разбирается по двоеточиям до разрешения переменных.
Параметры `--no-interpolate --no-env-resolution --no-consistency` не предотвращают ошибку.
Официальный 5.7.1 на том же input успешно возвращает буквальный immutable broker image.

## Исправление и границы

Выбран [официальный стабильный Compose 5.7.1](https://github.com/docker/compose/releases/tag/v5.7.1),
опубликованный 11.11.2026. Он собран Go 1.27.4; release также исправляет проверку OCI manifest
digests и целостность cache. Linux installer закрепляет оба официальных checksum и проверяет
их до выполнения binary. Смена файла атомарна. При неправильном checksum прежний plugin
остаётся на месте; это проверяет отрицательный CLI test.

Один installer используется Linux CI и production. CI устанавливает plugin в пользовательский
каталог, production использует `/usr/local/lib/docker/cli-plugins`. Пакет Ubuntu и его файл
не перезаписываются и остаются способом возврата. Полный provisioning на работающем VPS
не запускается. Сам installer не перезапускает Docker или контейнеры. Перед применением на
production требуется production lock и сохранение прежнего выбора plugin.

Проверки runtime archives сохраняют пределы размера, SHA-256, набор четырёх обычных файлов
и отказ от переменных в broker image. `--env-file /dev/null` отдельно исключает неявный `.env`;
серверные env files не читаются и переменные не вычисляются. Новые реальные CLI tests проверяют
обязательный bind mount без env files и отказ разрешать broker identity из окружения.

Проверка совместимости включает полный проектный CI с Compose 5.7.1 и Engine 28.0.4,
native foundation jobs обеих архитектур и проверку моделей на production Engine 29.1.3.
Версия считается применённой после фактической проверки выбранного plugin, а не после скачивания.
Все оставшиеся находки бинарного файла и ограничения проверок записываются в production lock #2144.
