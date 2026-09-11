# Личный кабинет с боковой навигацией — #494

Дата: 2026-09-11. Фиксированная база Platform: `bcbcfc3c4fb45eda882c080b87df77df6e1fe21f`.

Живые снимки сделаны на локальном `next dev` для маршрутов кабинета с действующей сессией.
Ответы `/api/account`, `/api/account/billing`, `/api/account/billing/contact` и
`/api/account/notifications/preferences` подставлены на границе браузера представительными
состояниями: действующая подписка, оплаченный доступ и независимое бессрочное право на
руководство, подтверждённый email, включённый канал email, неподключённый Telegram. Размеры совпадают с проектами
Playwright: desktop 1440 и mobile 390. Высота окна увеличена, потому что прокруткой владеет
`#content`, а не страница.

| Файл | Что показывает |
| --- | --- |
| `profile-desktop.png` | «Профиль»: боковая навигация слева, редактор и проекция участника справа |
| `profile-mobile.png` | «Профиль» на 390 px: список разделов свёрнут, порядок «редактор → проекция» сохранён |
| `access-desktop.png` | «Аккаунт»: только связь с Telegram и выход; продающего блока и внешней ссылки нет |
| `access-mobile.png` | «Аккаунт» на 390 px |
| `purchases-desktop.png` | «Покупки»: основания доступа со сроками, способ оплаты, история списаний и сообщений, email для чеков |
| `purchases-mobile.png` | «Покупки» на 390 px |
| `subscription-desktop.png` | «Подписка»: тариф, оплаченный срок, следующее списание и управление продлением; способа оплаты и истории здесь нет |
| `subscription-mobile.png` | «Подписка» на 390 px |
| `notifications-desktop.png` | «Уведомления»: каналы сообщений о новых материалах |
| `notifications-mobile.png` | «Уведомления» на 390 px |
| `sections-list-mobile.png` | Раскрытый список разделов на телефоне; принятая нижняя навигация не меняется |
| `reminder-desktop.png` | Тихий значок в шапке, пока Telegram не подключён |
| `reminder-modal-desktop.png` | Окно подключения поверх текущей страницы: коротко сказано, что даёт бот |

Состояния разделов без живого сервера — загрузка, завершённая сессия, недоступность, пустые
списки, отменённая и завершённая подписка, запрещённая карта — проверяются в Storybook:
`Pages/Account/Profile`, `Pages/Account/Access`, `Pages/Account/Telegram connection`,
`Pages/Account/Purchases`, `Pages/Account/Subscription`, `Pages/Account/Notifications`,
`Pages/Account/Section navigation`.
