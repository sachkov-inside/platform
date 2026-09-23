# Возврат в «Покупках» — #681

Снимки Storybook-истории `Pages/Account/Purchases → RefundedPurchase` на сборке ветки
`feat/681-refund-notice`. Горизонтального переполнения нет: `scrollWidth − clientWidth = 0` на
обеих ширинах.

| Файл | Что показывает |
|---|---|
| `purchases-refunded-desktop.png` | 1440 px: у разовой покупки строка «Возвращено 2 500 ₽ · дата», в «Сообщениях» — «Возврат выполнен» с суммой |
| `purchases-refunded-mobile.png` | 390 px: те же строки без переполнения |
