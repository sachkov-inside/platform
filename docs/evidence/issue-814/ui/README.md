# #814 — плашка потока и кнопка по этапу

Живой маршрут `/products/ai-engineering` production-сборки web против подставки backend: страница
курса из снимка описания Content, поток из `GET /billing/cohorts`, предложение из
`GET /billing/offers`. Ширина 1440 и 390, горизонтальной прокрутки нет ни на одном этапе.

| Этап | Кнопка | Снимки |
|---|---|---|
| Анонс, гость | «Читать главу 1 бесплатно» — вход, возврат в программу | `announcement-desktop.png`, `announcement-mobile.png` |
| Предзаказ | «Оплатить 4 900 ₽» → `/products/ai-engineering/buy` | `preorder-desktop.png`, `preorder-mobile.png` |
| Поток идёт | «Оплатить 4 900 ₽» → страница оплаты | `running-desktop.png`, `running-mobile.png` |
| Между потоками | «Оплатить» → страница оплаты | `between-desktop.png`, `between-mobile.png` |

Тексты плашек — черновик «Тексты запуска потока 1» из Inside Content, их примет владелец.
