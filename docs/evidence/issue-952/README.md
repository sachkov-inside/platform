# #952: Storybook и живые маршруты — сверка вида

Каждый снимок — пара «история страницы в собранном Storybook» слева и «тот же маршрут на локальном
стенде» справа, на ширине 390 (полная страница) и 1440 (кадр 1440×2600: с `lg` прокручивается
`#content` оболочки). Стенд — одноразовый Compose-проект `inside-platform-952` с
`LOCAL_SEED_VIEW=checks` (опубликованный демо-каталог), гость. Перед каждым снимком проверено, что
`scrollWidth === clientWidth`: горизонтальной прокрутки нет ни на одном из 36 кадров.

| Пара | История | Маршрут |
| --- | --- | --- |
| `home` | `Pages/Home` · No pinned guide | `/` |
| `product` | `Pages/Guide/Product` · Desktop | `/products/platform-inside` |
| `programme` | `Pages/Guide/Programme` · Locked series invites payment | `/products/platform-inside/programme` |
| `reader` | `Pages/Material Reader` · Short material | `/materials/kak-ustroen-inside-platform` |
| `topic` | `Pages/Topic` · Topic desktop | `/topics/platform` |
| `subscription` | `Pages/Subscription/Storefront` · Not offered | `/subscription` |
| `legal-terms` | `Pages/Legal/Документ` · Current | `/legal/terms` |
| `map` | `Pages/Map` · Desktop | `/map` |
| `bookmarks-guest` | `Pages/Bookmarks` · Sign in required | `/bookmarks` |

Состав и порядок блоков совпадают во всех парах. Различаются данные: fixtures историй против
демо-seed, поэтому другие тексты, обложки и число материалов. Блок «Что внутри продукта» на странице
продукта есть только у продукта с главами; у демо-продукта глав нет. Справа поверх страницы видны
уведомление о хранении (первый визит; в историях оно по умолчанию принято, вариант первого визита —
`storageNotice: "first-visit"`) и индикатор dev-сервера Next.js, которого нет в production-сборке.
