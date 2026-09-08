# #406: локальная проверка контакта

`pnpm smoke:billing-contact` на Node 24.19.0 подтвердил путь браузер → BFF → API → PostgreSQL →
Nodemailer → loopback SMTP capture → ввод кода → сохранение → reload. Screenshots `contact-*`
показывают пустое состояние, ввод кода и подтверждённый адрес при 1440×1024 и 390×844.
Проверки WCAG 2 A/AA и 2.1 AA формы — без нарушений; горизонтального overflow нет.

Identity, почта и legal fixtures синтетические. Скрипт не отправляет сообщения реальным людям,
не доказывает Logto/SMTP production-доставку, оплату или принятие реальных юридических текстов.
Final visual integration/owner visual GO формы и checkout остаются в #411.
