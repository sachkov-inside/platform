# Приёмка тарифов, Tribute и Telegram

Owning task: Platform #625, specification Workspace #180. [Матрица](subscription-access-convergence.json) сохраняет все 39 исходных сценариев и ожидаемых результатов. `local_pass` означает сочетание проверенных путей двух настоящих приложений и точных проверок границ в owning сервисе с PostgreSQL. Это не 39 отдельных browser tests. Версии, команды и границы evidence указаны в [каталоге](../evidence/tribute-access-convergence/README.md). Итоговый current-head review/CI gate отмечается отдельно; прежние результаты #624/#64 не выдаются за результат #625.

Проверки проходят через реальные Platform и Telegram приложения с отдельными PostgreSQL. Внешние Telegram/Tribute/банк заменяются контролируемыми провайдерами. Временные credentials, raw identity, данные участников и браузерные сессии в отчёт не включаются.

Незакрытые внешние gates: credentialed source/signature/export completeness, реальные сроки и построчный разбор, управление двумя ботами и rollback/cutover (#150), условия новых покупок/сопровождения (#179), явное разрешение конкретного rollout. Локальный PASS не означает production launch и не закрывает Workspace #180 автоматически.
