# Просмотр главы в авторском предпросмотре (#806)

Снимки одной production-реализации `MaterialCurrentPreview`: из Storybook и с живого маршрута
`/authoring/materials/:id/preview` полного локального стека.

| Файл | Что показывает |
|---|---|
| `storybook-desktop.png`, `storybook-mobile.png` | Материал в середине главы: состав по главам раскрыт, пустая глава, материалы вне глав, строка о видео, соседние материалы внизу |
| `storybook-first-material.png` | Первый материал: «Назад» недоступна, ссылка на другое руководство материала |
| `storybook-route-unavailable-mobile.png` | Состав не прочитан: причина названа, материал показан |
| `route-desktop.png`, `route-mobile.png` | Живой маршрут на 1440 и 390: сценарий кладёт материал руководства из сида в главу и открывает его первым, остальные материалы, включая черновики, стоят «Вне глав» |

Живые снимки пишет сценарий `trusted author walks a guide chapter through Previews that stay
closed to a guest` в `apps/web/test/fullstack/material-authoring.spec.ts`:

```bash
CAPTURE_EVIDENCE=1 UPDATE_EVIDENCE=issue-806 pnpm smoke:fullstack
```
