# Ссылки материалов — функциональная версия

Задача: [#1546](https://github.com/sachkov-inside/platform/issues/1546).
Окончательное визуальное согласование: [#1547](https://github.com/sachkov-inside/platform/issues/1547).

Новый production-модуль `MaterialLinkPreview` использует текущие поля редактора. Storybook и
публичный PNG используют общую композицию `SocialCardArtwork`. Черновик не передаётся публичному
генератору изображений. Обложка сохраняется существующим отдельным путём и сразу обновляет карточку.

Снимки Storybook: [desktop 1440 × 1024](link-preview-desktop.png),
[mobile 390 × 844 с длинным названием](link-preview-mobile.png). На mobile горизонтального
переполнения нет. Axe не нашёл нарушений на desktop и mobile после повышения контраста подписи автоматической картинки. Это доказательство функциональной версии, а не owner visual GO.

Проверки на production-сборке: `material-link-preview.spec.ts`, 10 сценариев на desktop/mobile:
TelegramBot с полным и коротким User-Agent, Googlebot; HTML без JavaScript, canonical без UTM,
открытый body, Article JSON-LD и доступный PNG; закрытый body и отсутствующий материал не получают Article.
Авторские строки безопасно сериализуются даже при `</script>` в названии или описании.

Локальный Vitest Storybook сообщает `No test suite found` как для нового файла, так и для
существующего `material-asset-upload-controls.stories.tsx`; MCP test-run повторяет этот результат.
Сценарии копирования, отказа clipboard, повтора после ошибки и живой правки дополнительно пройдены
через сам Storybook в браузере. Полный CI и сквозной сценарий с PostgreSQL фиксируются в PR.

Поисковые кабинеты не регистрировались, сообщения в Telegram не отправлялись, материалы не
публиковались. Проверки используют синтетические материалы. Deployment в эту задачу не входит.
