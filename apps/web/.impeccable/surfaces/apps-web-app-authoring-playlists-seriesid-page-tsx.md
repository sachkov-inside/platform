---
version: 1
slug: "apps-web-app-authoring-playlists-seriesid-page-tsx"
primary_target: "apps/web/app/authoring/playlists/[seriesId]/page.tsx"
related_targets: ["apps/web/app/authoring/playlists/page.tsx","apps/web/src/_pages/content-collections/ui/series-editor-page.client.tsx","apps/web/src/_pages/content-collections/ui/content-collections-page.client.tsx","apps/web/src/features/series-order/ui/series-order-manager.client.tsx"]
---

# Редактор серии и список серий

## Назначение

Режим: **Operate**. Автор открывает серию из общего списка и редактирует название,
описание, обложку и состав на отдельной странице. Поведенческий контракт —
[Редактор серии](../../../../docs/specifications/platform-v1.md#редактор-серии).

## Направление

Редактор напоминает рабочий документ: название и описание редактируются непосредственно
на странице; настройки переходят в нумерованный список материалов. Наследуются палитра,
типографика и shared controls из `DESIGN.md`. Референс Notion относится к способу работы
с документом, а не к замене визуальной идентичности продукта.

Desktop размещает обложку справа от описания. Mobile сохраняет порядок: название,
описание и адрес → обложка → материалы. Тонкие разделители объединяют плоские строки;
редактирование последовательности шагов раскрывается у нужного материала.
На mobile кнопки перестановки и удаления делят строку со статусом публикации.
Верхний статус сохранения явно относится к настройкам, состав показывает свой статус.

## Доказательства и статус

Production-owned editor и список представлены в Storybook: `Pages/Authoring/Редактор серии`.
Responsive captures и результаты проверок находятся в
[доказательствах #425](../../../../docs/evidence/issue-425/README.md).
Использованы демонстрационные данные; owner visual acceptance и merge остаются отдельными решениями.
