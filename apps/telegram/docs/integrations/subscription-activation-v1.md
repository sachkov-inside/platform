# Course Activation

Текущий runtime Module называется `course-activation`. Правило указывает Product напрямую,
подтверждённый отдельный источник выдаёт один бессрочный Product Access. Повтор и другой
источник сохраняют первую выдачу. После ручного отзыва бот оставляет запрос владельцу.
Три календарных месяца сопровождения отсчитываются от фактической бесплатной выдачи,
срока отключения доступа нет.

Общий [portable protocol](../../../../docs/contracts/subscription-activation-v1/protocol.md)
задаёт точный binding, отдельное полномочие, сохранение прежних receipts и проверяемый
порядок перехода с `/subscription-activation` на `/course-activation`.
Wire version `inside.subscription-activation.v1` сохранена для совместимости записанных
ответов. Она не включает подписки, Tribute, invitations или entitlement bridge.

Проверка членства использует отдельный Activation Source. Общая группа запрещена в реестре
источников. Один код ссылки не подтверждает прохождение курса. Обычные start и sign-in
не создают попытку активации. Linking сохраняет identity, correlation, exact binding и
возобновляет только уже начатое явное обращение.
