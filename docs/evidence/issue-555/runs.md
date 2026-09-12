# Прогоны на живом стенде

Стенд поднимался своими контейнерами и портами: проект Compose `platform-555`, PostgreSQL 54397,
MinIO 9046/9047, web/api/mcp 3020/3021/3022. Чужие слоты не занимались.

`pnpm smoke:fullstack` печатает список сценариев только при падении, а при успехе завершается
кодом 0 и строкой `Full-stack smoke passed`. Поэтому ниже красные прогоны показаны списком, а
зелёные — командой и итогом.

## Дефект воспроизведён (до починки, `3e80f1bd`)

```
FULLSTACK_TEST_GREP='preserves SSR geometry' pnpm smoke:fullstack

✘ [desktop-chromium] personal Home preserves SSR geometry through authenticated hydration
    Expected: 121   Received: 113
✘ [mobile-chromium]  personal Home preserves SSR geometry through authenticated hydration
    Expected: 32    Received: 24
2 failed
```

## Три соседних сценария были красными до #547

С починкой и без неё падали одни и те же три сценария и одинаково, на чистом `3e80f1bd`:

```
FULLSTACK_TEST_GREP='personal Home opens the real series|personal Home resumes real Video progress|personal Home preserves the public hub' pnpm smoke:fullstack

✘ personal Home opens the real series, persists marks and reconciles a lost visible open
✘ personal Home resumes real Video progress in the normal video section and excludes playback end
✘ personal Home preserves the public hub through errors and excludes denied, prefetched and SSR opens
6 failed (настольный и мобильный)

Locator: getByRole('link', { name: 'Продолжить руководство Demo · Прогресс обучения' })
Expected substring: "изучено 1 из 3"
```

Это ждало продолжения обучения из #547. После сведения с `dcdb386b`, где #547 уже смержен, все
шесть сценариев личной главной зелёные.

## Итоговые зелёные прогоны

| Команда | Итог |
| --- | --- |
| `FULLSTACK_TEST_GREP='personal Home' pnpm smoke:fullstack` | код 0, `Full-stack smoke passed` — все шесть сценариев на настольном и мобильном |
| `FULLSTACK_TEST_GREP='pending overlay over the home page\|personal Home' pnpm smoke:fullstack` | код 0 — то же плюс временная проверка накладки перехода |
| `pnpm --filter @inside/web test` | 880 зелёных, 1 пропущен |

## Накладка перехода: одинаковые номера в документе

Мобильная оболочка держит прежнюю страницу в документе, пока открывается следующая, и показывает
поверх неё `HomeLoading`. Когда скелет стал рисовать настоящую секцию руководств, в документе
оказалось два элемента с номером `home-series`. Временная проверка на живом стенде: открыть `/`,
задержать запросы `_rsc`, нажать «Закладки» в мобильной навигации.

| Замер | Пока номер был общим | После починки |
| --- | --- | --- |
| Элементов `#home-series` | 2 | 1 |
| Ссылок `aria-labelledby="home-series"` | 2 | 1 |
| Нарушений axe | 0 | 0 |

Нарушений axe не было в обоих случаях: прежняя страница скрыта через `visibility: hidden`, и axe её
не смотрит. Но два одинаковых номера в документе — недопустимая разметка, поэтому правило
`home-page.css` больше не опирается на номер заголовка: у него теперь свой класс
`home-series-section`, а номер заголовка задаёт вызывающий и у скелета он свой.
