# Вход через Telegram, бот и Mini App: технические варианты

> Историческое исследование на указанную в документе дату. Оно не задаёт текущие правила.
> Источник: [Workspace](https://github.com/sachkov-inside/workspace/blob/125cbde1631a0c9c314a29c829961ab8aa785a06/docs/research/2026-09-06-telegram-entry-technical-options.md); текущие правила — [документы Platform](../../README.md).

Дата проверки: 2026-09-06. Статус: исследование для обсуждения, без изменения принятой архитектуры и без разрешения на выпуск. Правовую квалификацию способов входа следует читать в [отдельной правовой записке](2026-09-06-telegram-auth-russia-product-options.md): эта записка не утверждает законность или незаконность ни одного варианта.

## Основной вывод

Удобный путь «бот → открыть Platform» технически возможен без Mini App. Однако обычная ссылка, одноразовый вход и подтверждение браузерной сессии — три разных механизма. Если Platform выдаёт доступ только потому, что пользователь нажал кнопку из своего Telegram, Telegram участвует в аутентификации независимо от владельца кода бота. Это описание границы доверия, не правовая квалификация.

Mini App имеет самостоятельный смысл как интерфейс для регулярного короткого использования внутри Telegram. Он не нужен ради одной кнопки входа. Для синхронизации нужны один Account и серверные данные, а не общие cookies между приложениями. Сценарий полностью внутри Mini App следует юридически рассматривать отдельно от выдачи им сессии внешнему сайту.

## Что уже есть в Inside

Проверены локальные исходники Platform `61f1e3a35f559fbb94f9b1688d85eddfbe8876ac` и Telegram `e788704b8458074fd4b2fbd8f0cdcf2198da5ee7`. Сведения о прошлых проверках ниже взяты из документов; production и реальные пользовательские входы в этом исследовании не проверялись.

| Слой | Принятое поведение | Основание |
| --- | --- | --- |
| Вход Platform | Logto проверяет email-код; официальный `@logto/next` хранит единственный BFF authentication context в encrypted HttpOnly cookie | [Account contract](https://github.com/sachkov-inside/platform/blob/61f1e3a35f559fbb94f9b1688d85eddfbe8876ac/docs/specifications/identity-principals-session-v1.md), [IdP flow](https://github.com/sachkov-inside/platform/blob/61f1e3a35f559fbb94f9b1688d85eddfbe8876ac/docs/specifications/idp-application-flow-v1.md) |
| Account | Собственный UUID; уникальная пара Logto issuer + subject. Первый callback требует `inside_verified_email`. Совпавший email другого subject не вызывает merge | [Account contract](https://github.com/sachkov-inside/platform/blob/61f1e3a35f559fbb94f9b1688d85eddfbe8876ac/docs/specifications/identity-principals-session-v1.md), [JWT verifier](https://github.com/sachkov-inside/platform/blob/61f1e3a35f559fbb94f9b1688d85eddfbe8876ac/apps/backend/src/modules/accounts/infrastructure/idp/logto/logto-access-token-verifier.ts) |
| Привязка Telegram | Уже вошедший Account создаёт короткую ссылку; `/start` подтверждает Telegram identity; завершение — из authenticated Platform flow | [Controller с AccountGuard](https://github.com/sachkov-inside/platform/blob/61f1e3a35f559fbb94f9b1688d85eddfbe8876ac/apps/backend/src/modules/telegram-membership/adapters/nest/telegram-link.controller.ts), [Telegram linking](https://github.com/sachkov-inside/inside-telegram/blob/e788704b8458074fd4b2fbd8f0cdcf2198da5ee7/src/modules/identity-linking/identity-linking.ts) |
| Контакт бота | Обычный `/start` создаёт BotContact даже без Account и Membership | [Telegram brief](https://github.com/sachkov-inside/inside-telegram/blob/e788704b8458074fd4b2fbd8f0cdcf2198da5ee7/docs/product/telegram-application-brief.md), [Update processor](https://github.com/sachkov-inside/inside-telegram/blob/e788704b8458074fd4b2fbd8f0cdcf2198da5ee7/src/modules/update-inbox/telegram-update-processor.ts) |
| Доступ | Platform принимает ограниченное во времени Membership Evidence и сама решает доступ; наличие привязки не равно доступу | [Consumer conformance](https://github.com/sachkov-inside/platform/blob/61f1e3a35f559fbb94f9b1688d85eddfbe8876ac/docs/verification/telegram-membership-conformance.md) |

Текущая терминология прямо запрещает называть PlatformLink входом. Telegram identity исторически принадлежит одному Account; перенос — отдельная проверяемая владельцем операция. [Telegram CONTEXT](https://github.com/sachkov-inside/inside-telegram/blob/e788704b8458074fd4b2fbd8f0cdcf2198da5ee7/CONTEXT.md).

Выбран именно Logto OSS с отдельным собственным deployable, а не Logto Cloud. Локальный proof поднимает pinned `inside/logto-proof:1.41.0-inside.2`, собственную PostgreSQL и тестовый Mailpit. Это не подтверждение размещения production в России: README прямо исключает production template, а production routing/client setup остаются отдельной работой. Географию действующего deployment по этим файлам установить нельзя. [Logto proof README](https://github.com/sachkov-inside/platform/blob/61f1e3a35f559fbb94f9b1688d85eddfbe8876ac/infra/identity/logto/README.md), [Compose](https://github.com/sachkov-inside/platform/blob/61f1e3a35f559fbb94f9b1688d85eddfbe8876ac/infra/identity/logto/compose.yaml), [local-development](https://github.com/sachkov-inside/platform/blob/61f1e3a35f559fbb94f9b1688d85eddfbe8876ac/docs/runbooks/local-development.md).

В исследованных runtime paths не обнаружена реализация Mini App `initData`, Telegram OIDC login, `login_url` или bot-issued magic-link authentication. Backend linking уже существует; наличие законченного пользовательского web linking flow этим не доказано.

Есть документированные интеграционные проверки связывания, конфликтов, повторов и Membership. Credentialed proof от 31 августа проверял временный webhook и идентичность тестового бота; реальные private `/start`, block/unblock и несколько других пользовательских сценариев отмечены `Not run`. Нельзя говорить, что полный живой сценарий входа через бота уже проверен. [Telegram proof](https://github.com/sachkov-inside/inside-telegram/blob/e788704b8458074fd4b2fbd8f0cdcf2198da5ee7/docs/verification/credentialed-telegram-proof.md).

## Варианты пользовательского пути

Следующая таблица — проектные варианты автора исследования, а не уже реализованные функции.

| Вариант | Новый пользователь | Возвращающийся пользователь | Цена решения |
| --- | --- | --- | --- |
| Бот открывает обычный сайт | Входит через основной способ Platform; затем подтверждает привязку | Действующая cookie сразу открывает Account; иначе обычный вход | Минимум новой auth-логики; Telegram сам не выдаёт сессию |
| Telegram Login OIDC | Telegram proof; по текущему контракту затем нужен email и разрешение возможного конфликта | Провайдер разрешает уже связанную identity в тот же Account | Отдельный identity integration и юридическая оценка внешнего login |
| Одноразовая ссылка из бота | Нельзя безопасно угадать существующий Account по имени; нужна регистрация или доказательство владения Account | Бот выдаёт короткий одноразовый билет на связанный Account | Собственный чувствительный протокол, риск пересылки билета |
| Бот подтверждает исходный браузер | Для неизвестной identity — onboarding; для связанной — явное подтверждение входа | На сайте запрос, в боте подтверждение, исходная вкладка получает сессию | Хорошо подходит desktop + phone, но нужны защита от фишинга и интеграция с IdP |
| Mini App внутри Telegram | Verified Telegram identity; определить, создавать ли Account или сначала связывать существующий | Сразу открыть нужный экран по серверной связи | Отдельная webview-поверхность, lifecycle и тесты; внешний браузер сам не войдёт |

### Обычная кнопка «Открыть платформу»

Рекомендуемый первый эксперимент при сохранении текущего Account contract: `/start` → кнопка сайта → обычный Logto flow при отсутствии сессии → понятное подтверждение Telegram-привязки. Контекст перехода можно сохранить в короткой серверной транзакции. Для связи с существующим Account пользователь должен доказать владение им.

Telegram deep links передают `start` длиной до 64 символов. Это транспорт параметра, не доказательство владения Account. Не помещать в него email, Account ID как право доступа или долгоживущий секрет. [Telegram deep linking](https://core.telegram.org/bots/features#deep-linking).

### Telegram Login OIDC

Текущая официальная документация описывает новый OIDC Authorization Code Flow с S256 PKCE; старый iframe widget архивирован. Клиент и разрешённые redirect URI регистрируются через BotFather. Discovery: `https://oauth.telegram.org/.well-known/openid-configuration`. Отдельного UserInfo endpoint нет: claims приходят в ID token. `profile` даёт `id`, `openid` — `sub`; пример Telegram показывает разные значения, поэтому нельзя приравнять `sub` к Bot API user ID. `phone` требует согласия; `telegram:bot_access` разрешает сообщения бота. Сервер проверяет подпись, issuer, audience, expiry и связь с начатой транзакцией. [Telegram Login](https://core.telegram.org/bots/telegram-login).

Для Inside это кандидат на интеграцию с принятым IdP, а не повод создавать второй набор cookie вручную. Совместимость конкретной версии Logto с Telegram OIDC и отсутствием UserInfo здесь не проверялась. Наличие generic OIDC не доказывает готовность connector. Telegram-only callback также не удовлетворяет текущему требованию `inside_verified_email`: понадобится явное изменение Account onboarding или email-подтверждение. [Принятая архитектура](https://github.com/sachkov-inside/platform/blob/61f1e3a35f559fbb94f9b1688d85eddfbe8876ac/docs/adr/0006-logto-session-and-local-account.md).

### Одноразовая ссылка из бота

Предлагаемая схема: подтверждённый update пользователя → сервер находит существующую связь → создаёт случайный билет, хранит digest и срок → бот показывает кнопку → сервер атомарно погашает билет → установленная auth-система завершает вход.

Такой билет представляет право входа. Получатель пересланной ссылки может оказаться не тем человеком. Привязка к исходному браузеру уменьшает риск, но нарушает удобство входа из любой среды. По этой причине свободно переносимый magic link не рекомендован как первый основной путь.

Проектные меры: срок порядка нескольких минут; single-use с атомарным погашением; отдельные назначения `login` и `link`; отсутствие bearer в аналитике и логах; фиксированный allowlist return URL; `no-store` и `Referrer-Policy: no-referrer`; экран подтверждения вместо необратимого consume простым GET. Последнее защищает от непреднамеренного открытия ссылок предпросмотром. Нельзя отправлять в URL готовую cookie, access token, refresh token или Telegram bot token.

### Подтверждение исходной вкладки через бота

Проектный сценарий для desktop: сайт создаёт запрос и привязывает его к браузерному секрету; показывает QR и короткое контрольное число. Бот получает ссылку и явно спрашивает, хочет ли человек войти именно в этот браузер. После подтверждения исходная вкладка завершает одноразовый обмен, а не получает готовую cookie через Telegram. На телефоне человек возвращается в начальную вкладку; на другом устройстве она обновляется сама.

Это схема по мотивам device authorization, не утверждение, что Telegram или установленный Logto уже поддерживает соответствующий grant. RFC отдельно описывает угрозу: злоумышленник пересылает свою ссылку и убеждает жертву подтвердить вход. Контрольное число, явное описание устройства и отказ от unsolicited login approvals снижают риск, но не гарантируют защиту от социальной инженерии. [RFC 8628, §3.3.1 и §5.4](https://www.rfc-editor.org/rfc/rfc8628.html#section-5.4).

Одного факта `/start token` недостаточно для выдачи браузерной сессии: это может быть обычная навигация. Нужны отдельное намерение входа и доказательство владения исходной браузерной транзакцией. Login CSRF — реальная отдельная угроза: жертва может попасть в Account злоумышленника и загрузить туда свои данные. Стандартные OAuth защиты — PKCE, корректная корреляция `state` и при использовании `nonce` его проверка. [RFC 9700, §4.7](https://www.rfc-editor.org/rfc/rfc9700.html#section-4.7).

## Mini App и синхронизация

### Отдельный вариант: телефонный код через Telegram Gateway

Telegram Gateway доставляет verification code по номеру телефона, который пользователь добровольно передал сервису. Сервис вызывает отдельный `gatewayapi.telegram.org`, а человек вводит полученный код в Platform. Это не `/start` собственного бота и не аутентификация по `Telegram.User.id`; Gateway сам не раскрывает номер и требует согласие на доставку через Telegram. [Gateway overview](https://core.telegram.org/gateway).

API принимает номер E.164, позволяет задать код самому либо попросить Telegram сгенерировать его, а `checkVerificationStatus` проверяет введённый код для конкретного request. [Gateway API](https://core.telegram.org/gateway/api).

Проектный вывод: это кандидат на дополнительный транспорт подтверждения номера при phone-first модели, с fallback для недоступного Telegram. Получение контакта кнопкой `request_contact` в боте — другой пользовательский сценарий; оно не заменяет автоматически принятую Platform проверку номера и не связывает два Accounts. Внутреннее приложение должно проверять отправителя и принадлежность контакта, а не принимать произвольную пересланную карточку. Gateway не создаёт автоматически BotContact/PlatformLink нашего бота. Правовая допустимость такого phone-verification транспорта требует отдельного ответа; название «вход по номеру» его не доказывает.

### Интерфейс и авторизация Mini App

Mini App — web-интерфейс внутри Telegram. Для персонального кабинета подходят inline/menu/main Mini App launch. Backend должен проверить сырое `initData`, не доверяя `initDataUnsafe`: HMAC по официальному алгоритму либо Ed25519 signature с привязкой к bot ID, плюс свежесть `auth_date`. User ID хранить без 32-bit усечения. `openLink` открывает браузер по пользовательскому действию; это не передача браузерной cookie. [Telegram Mini Apps](https://core.telegram.org/bots/webapps).

Проектная защита от replay сверх проверки подписи: короткое допустимое окно времени; clock-skew policy; обмен на внутренний ограниченный authentication context; digest/nonce с durable consume и продуманным идемпотентным повтором сетевого запроса. `auth_date` лишь ограничивает возраст и сам по себе не делает данные одноразовыми. Не использовать весь `initData` как постоянный bearer для каждого бизнес-запроса.

Mini App проверяет Telegram identity, а Account определяется существующей серверной связью. Первый запуск не должен молча создавать второй Account вместо существующего. Если выбран email-first contract, незнакомой identity предложить обычный вход/создание Account, после него явную привязку. Если выбран Telegram-first contract, заранее определить восстановление, дополнительные способы входа и доказательство объединения. Username, имя, аватар и простое совпадение номера не являются разрешением объединить Accounts. Bot API задаёт отдельный уникальный `User.id`; `username` необязателен. [Bot API User](https://core.telegram.org/bots/api#user).

Сервер хранит единые Account, Membership, прогресс и настройки. Web и Mini App читают их через свои проверенные authentication contexts. При добавлении Mini App нужно отдельно решить совместимость с принятой Logto-сессией; автоматически выдавать Logto cookie по произвольному Telegram payload нельзя.

Пример синхронизации: человек отметил урок в Mini App → Platform сохранила прогресс для Account UUID → сайт при следующем чтении показывает то же значение. Это не требует общей cookie и не должно зависеть от того, какой клиент последний прислал Telegram update. Модель хранения прогресса здесь предложена как пример, её текущая реализация не проверялась.

### Телефон, desktop и cookie

Нельзя обещать, что вход в Telegram webview авторизует Safari/Chrome. Android документирует собственное управление cookies WebView внутри приложения. Telegram не даёт в Mini App API общего browser-cookie bridge. Практическое проектное допущение: Telegram webview, системный браузер, desktop и Telegram Web — разные контексты, пока конкретная комбинация не проверена. [Android CookieManager](https://developer.android.com/reference/android/webkit/CookieManager).

Следствие для обычной bot URL: она может привести пользователя в браузер без прежней Platform cookie. Для сценария «нажал на компьютере, подтвердил телефоном» лучше завершать исходную транзакцию на компьютере. Для сценария «живу внутри Telegram» Mini App сокращает переходы. Перенос из Mini App во внешний сайт требует собственного явного handoff либо обычного входа; его юридическая оценка отдельна.

### Когда Mini App оправдан

Проектная рекомендация: начать с лёгкой поверхности «мой доступ», «продолжить», «избранное», «статус привязки», если продукт подтверждает частые короткие визиты из Telegram. Сложный редактор, длинные занятия и работа с кодом могут оставаться на основном сайте. Это продуктовая гипотеза, её нужно проверить на собственных пользователях.

Минимальный пилот должен проверить iOS/Android/Desktop/Telegram Web: первый и повторный запуск, открытие внешнего браузера, переключение Telegram identity, потерю сети, истёкший `initData`, повторный обмен, logout, отказ от связывания и конфликт Account. Счётчики успеха: доля завершивших вход, время до материала, количество неожиданных повторных входов и обращений по неверной привязке. Сам факт открытия webview не является успехом входа.

## Оплата цифрового доступа

Telegram требует Stars для продажи цифровых товаров и услуг внутри bots/Mini Apps, даже если у продавца есть внешний сайт с другой оплатой. Для подписки на цифровые материалы это существенный продуктовый вопрос. Приём в другой валюте может сделать bot/Mini App недоступным мобильным пользователям. Нужно обрабатывать `successful_payment`, возвраты и `/paysupport`; одного pre-checkout approval недостаточно. [Telegram Stars FAQ и payment flow](https://core.telegram.org/bots/payments-stars).

Исследованные документы Telegram не дают основания обещать универсальное исключение «кнопка ведёт на внешний checkout, значит Stars не нужны». Возможность только читать ранее приобретённый контент и конкретный путь привлечения к оплате следует оценить отдельно по актуальным правилам платформы. У существующего Inside Telegram brief billing вообще исключён из v1; добавление оплаты не входит в нынешнюю реализацию bridge. [Telegram brief](https://github.com/sachkov-inside/inside-telegram/blob/e788704b8458074fd4b2fbd8f0cdcf2198da5ee7/docs/product/telegram-application-brief.md).

## Предлагаемая последовательность решения

1. Сохранить один Account и отделение Telegram identity от Membership; не использовать `/start` как скрытое автоматическое объединение.
2. Улучшить основной email-вход и обычную кнопку бота; прототипом проверить потерю browser context на телефоне.
3. Отдельно оценить Mini App как место использования продукта внутри Telegram, учитывая самостоятельную правовую трактовку этого сценария.
4. Если выбран дополнительный Telegram login внешнего сайта, сравнить OIDC через текущий IdP и подтверждение исходной вкладки. До реализации подтвердить Account onboarding/recovery и юридическую модель.
5. Не вводить одновременно Mini App, перенос сессий во внешний браузер и новую оплату: это три самостоятельные границы, которые требуют отдельной проверки.

Новые пользовательские функции, внешние настройки Telegram и код в ходе исследования не менялись. Автоматические тесты приложений не запускались: результат — документальное исследование с чтением исходников, а не новый proof реализации.
