# Профиль: имя, Telegram и почта

Задача #1586, спецификация #1585, PR #1583. Визуальное принятие отслеживается в #1587.
Снимки сделаны из исходного дерева этого commit. Runtime-интерфейс совпадает с `e798fe8b2`;
последующие изменения касаются тестов, документации и временного маркера.
Это доказательство подготовленного результата, а не запись принятия владельцем.

| Среда | Компьютер | Телефон |
| --- | --- | --- |
| Storybook, синтетический Telegram и почта | [1440 px](storybook-desktop.png) | [390 px](storybook-mobile.png) |
| Настоящие Web/API/PostgreSQL, синтетический identity provider | [1440 px](live-desktop.png) | [390 px](live-mobile.png) |

Storybook: `Pages/Account/Live cabinet/With subscription`, viewport снимки.
Live: `/account` после сохранения имени и перезагрузки, целая страница через
`screenshotWholePage`. Прогон `CAPTURE_EVIDENCE=1` и `FULLSTACK_TEST_GREP='cabinet presents|cabinet saves'`
в `pnpm smoke:fullstack`, отдельные временные PostgreSQL и RustFS. Все четыре desktop/mobile
сценария прошли, включая email собственного Account, запрет чужого origin и анонимного чтения,
Axe без serious/critical нарушений и отсутствие горизонтального переполнения.
Временные сервисы после проверки удалены, общий стенд не менялся.

Пустая почта, код, неверный код, недоступность и истёкшая сессия представлены в
`Features/Account/Sign-in email`. Отдельная нативная проверка `scripts/account-email-proof.py`
использует настоящий Logto и подтверждает новый вход по email-коду с тем же subject.
