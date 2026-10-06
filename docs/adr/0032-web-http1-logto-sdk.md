---
status: accepted
---

# HTTP/1.1 для исходящего fetch серверного web

В [#992](https://github.com/sachkov-inside/platform/issues/992) совместная миграция
`@logto/next` 5.0.0 и `@logto/node` 4.0.0 встретилась с переходом платформы на Node 26.10.0.
Confidential transport Node SDK создаёт `Request` с телом формы. При передаче этого тела
нативный fetch Node 26 выбирает HTTP/2 по ALPN и отправляет поток без Content-Length.
Logto 1.44.0-inside.7 отвергает запрос: его OAuth parser не распознаёт тело без
Content-Length или Transfer-Encoding. Content-Type и поля формы при этом присутствуют.

Короткий TLS HTTP/2 fixture внутри настоящего Next.js воспроизвёл эту форму запроса.
По HTTP/1.1 тот же SDK отправляет Transfer-Encoding: chunked. Изолированная identity proof
проверяет вход и refresh через тот же серверный процесс с настоящим fork Logto.

## Решение

`apps/web/instrumentation.ts` устанавливает `undici.Agent({ allowH2: false })` через
`setGlobalDispatcher` в Node-only `register`. Это штатный
[интерфейс Node fetch](https://nodejs.org/api/globals.html#custom-dispatcher);
[Next.js register](https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation)
выполняется при запуске серверного экземпляра до обработки запросов.

Серверный web использует HTTP/1.1 для исходящего fetch, включая все экземпляры SDK
в callback и штатных session helpers. Это возвращает протокол предыдущего Node runtime
без замены fetch, буферизации токенов и изменения fork Logto. Browser fetch и входящий
HTTP-трафик это решение не меняет.

## Цена и пересмотр

У исходящего web fetch нет HTTP/2 multiplexing. В проекте нет отдельного dispatcher,
который нужно сохранить при запуске. Новую политику proxy или connection pool следует
совмещать с этим dispatcher в одном owning hook.

Вернуть HTTP/2 можно после исправления Logto parser либо сохранения Content-Length
в streaming Request. Перед удалением ограничения должны пройти реальный callback,
refresh и sign-out на Node 26 с fork, который используется платформой.
