# Next.js ↔ Nest: evidence for a constrained hybrid BFF

Статус: primary-source research, 2026-08-26. Это evidence для отдельного архитектурного
решения, а не уже принятый ADR. Термин **hybrid BFF** ниже — project label: официальные источники
описывают его составные части, но не вводят именно это название.

## Вывод

Для Platform обоснован следующий data path:

```text
RSC / server render ── server-only generated client ───────────────► Nest

Browser interaction ─► same-origin constrained 1:1 gateway
                          └─ resolves server-side Logto token ─────► Nest

Browser interaction ─► feature Route Handler ─► aggregate/map/cache ─► Nest
```

Это соответствует официальной модели Next.js и OAuth BFF при четырёх обязательных оговорках:

1. Server Components вызывают Nest напрямую, не через собственный Route Handler.
2. Browser не получает access/refresh token: Next server является confidential OAuth client,
   преобразует защищённую cookie session в audience-bound bearer token и добавляет его только к
   исходящему запросу в Nest.
3. Общий gateway не является blind catch-all proxy. Он допускает только явно опубликованные пары
   `method + OpenAPI path`, фиксированный Nest origin и известные request/response headers.
4. Cookie-authenticated gateway имеет отдельную CSRF-защиту; `SameSite` и отсутствие CORS сами по
   себе не считаются достаточной общей защитой.

Next.js прямо поддерживает BFF через Route Handlers, но предупреждает, что это публичные endpoints,
а не полноценная замена backend. Это совпадает с ролью Nest как единственного domain/resource
server ([Next.js BFF guide](https://nextjs.org/docs/app/guides/backend-for-frontend)). OAuth BCP
определяет BFF как серверный компонент frontend, который хранит tokens вне browser и проксирует
resource requests с правильным access token
([RFC 10017 §6.1](https://www.rfc-editor.org/rfc/rfc10017.html#section-6.1)); для business,
sensitive и personal-data applications BCP strongly recommends эту модель
([§6.1.4.3](https://www.rfc-editor.org/rfc/rfc10017.html#section-6.1.4.3)).

## 1. Server Components должны ходить прямо в Nest

Next.js даёт однозначную рекомендацию: Server Component должен читать data source напрямую, а не
вызывать Route Handler того же приложения. Для prerender это может сломать build, потому что HTTP
server ещё не запущен; для dynamic render это добавляет лишний network round trip
([Next.js BFF: Server Components caveat](https://nextjs.org/docs/app/guides/backend-for-frontend#server-components)).
Server Components предназначены в том числе для чтения API рядом с источником данных
([Next.js Server and Client Components](https://nextjs.org/docs/app/getting-started/server-and-client-components)).

Следствие для Platform: RSC вызывает feature-owned `server-only` adapter, а тот — один generated
Nest client. Этот путь всё равно является HTTP-вызовом Next server → Nest, но не проходит через
публичный `/api/**` Next endpoint. CORS к server-to-server fetch не применяется.
Здесь next.js-формулировка «directly from its source» означает Nest API, а не прямой Prisma/Postgres:
Nest уже является отдельным владельцем use cases, authorization и persistence boundary.

Для authenticated RSC есть Logto-specific ограничение. Официальный SDK предоставляет
`getAccessTokenRSC`, но Server Component не может записать обновлённый token обратно в cookie;
после expiration каждый RSC request может снова refresh-ить token. Logto предлагает external
session storage либо cookie-writing server boundary
([Logto Next.js quick start: RSC token caching limitation](https://docs.logto.io/quick-starts/next-app-router#fetch-access-token-for-the-api-resource)).
До production rollout Platform должен выбрать durable/shared session wrapper; process-local
single-flight уменьшает дублирование только внутри одного instance и не устраняет эту проблему.

## 2. Browser path — настоящий token-hiding BFF

RFC 10017 перечисляет три обязанности BFF: быть confidential OAuth client, держать access/refresh
tokens в cookie-backed server session без их выдачи browser и добавлять access token при
forwarding в resource server
([§6.1](https://www.rfc-editor.org/rfc/rfc10017.html#section-6.1)). Это более защищённый вариант,
чем token-mediating backend, который возвращает access token JavaScript.

Для Platform gateway должен:

- принимать только same-origin browser session cookie;
- получать audience-bound Platform token через server-only Logto adapter;
- удалять входящие `Authorization`, `Cookie`, `Host`, forwarding и hop-by-hop headers и создавать
  новый allowlisted outbound request;
- никогда не возвращать bearer/refresh token, upstream `Set-Cookie` или внутренние headers;
- оставлять окончательную authorization в Nest: BFF authentication не заменяет проверку token
  issuer/audience/permissions resource server-ом;
- применять timeout, body/content-type/size validation и rate limiting. Next отдельно требует
  валидировать payload, ограничивать abuse и не полагаться на proxy как на authorization boundary
  ([Next.js BFF security](https://nextjs.org/docs/app/guides/backend-for-frontend#security)).

Logto подтверждает, что server SDK получает token конкретного API resource и автоматически
использует refresh token при expiration
([Logto Next.js quick start](https://docs.logto.io/quick-starts/next-app-router#fetch-access-token-for-the-api-resource)).
Пример Logto допускает возврат token в Client Component, но для выбранного BFF это делать нельзя:
RFC 10017 связывает основное преимущество BFF именно с отсутствием tokens в browser.
Nest остаётся resource server и валидирует signature/JWKS, issuer, audience, expiry и permissions
([Logto: Protect your NestJS API](https://docs.logto.io/api-protection/nodejs/nestjs)).

Session cookie должна следовать требованиям RFC 10017: `Secure` и `HttpOnly` обязательны;
`SameSite=Strict`, path `/`, отсутствие `Domain` и host-prefixed name рекомендуются
([§6.1.3.2](https://www.rfc-editor.org/rfc/rfc10017.html#section-6.1.3.2)). Authorization Code flow
confidential client должен соответствовать OAuth Security BCP, включая PKCE
([RFC 9700 §2.1.1](https://www.rfc-editor.org/rfc/rfc9700.html#section-2.1.1)).

## 3. Почему нельзя делать unrestricted catch-all proxy

Next.js показывает catch-all Route Handler как допустимую proxy-технику, но требует validation до
forwarding
([Next.js: Proxying to a backend](https://nextjs.org/docs/app/guides/backend-for-frontend#proxying-to-a-backend)).
Это пример framework capability, а не разрешение пересылать произвольный path.

RFC 10017 формулирует более строгую security boundary: BFF обязан иметь фиксированный allowlist
resource servers; dynamic routing обязан разрешать только явно одобренные hosts и paths, а methods
следует ограничивать per endpoint. Иначе attacker может направить bearer token на чужой host или к
непредназначенному backend endpoint
([§6.1.3.6 Proxy Restrictions](https://www.rfc-editor.org/rfc/rfc10017.html#section-6.1.3.6)).

Поэтому один gateway file допустим только как **compiled dispatch table**, например:

```text
GET    /library/materials
GET    /materials/{slug}
POST   /authoring/materials
POST   /authoring/materials/{materialId}/revisions
...
```

Таблица может проверяться/генерироваться из canonical OpenAPI: OAS `Paths Object` задаёт точные
relative paths и доступные operations, а `Responses Object` — известные HTTP outcomes
([OpenAPI 3.1.1: Paths](https://spec.openapis.org/oas/v3.1.1.html#paths-object),
[Responses](https://spec.openapis.org/oas/v3.1.1.html#responses-object)). Но OpenAPI сам по себе не
является browser exposure policy: internal, service-only и future endpoints должны включаться
отдельно.
OpenAPI-generated client полезен для literal paths, params и responses; `openapi-fetch` официально
поддерживает generated `paths` и auth middleware
([openapi-fetch](https://openapi-ts.dev/openapi-fetch/),
[middleware/auth](https://openapi-ts.dev/openapi-fetch/middleware-auth)).

Оставшийся риск принципиален: malicious JavaScript в origin всё ещё может отдавать BFF команды от
имени пользователя. RFC называет это client hijacking; `HttpOnly` скрывает token/session bytes, но
не запрещает session riding. Сужение endpoints/methods, Nest authorization, CSP, rate limits и
sensitive-action confirmation уменьшают последствия, но не превращают XSS в безопасное событие
([RFC 10017 §5.1.4](https://www.rfc-editor.org/rfc/rfc10017.html#section-5.1.4),
[§6.1.4](https://www.rfc-editor.org/rfc/rfc10017.html#section-6.1.4)).

## 4. Same-origin, CORS и CSRF

Browser → Next gateway на одном origin не требует CORS/preflight. Next → Nest является
server-to-server и также не требует CORS. Следовательно, обычный Platform deployment не должен
включать broad CORS на Nest. Если позднее появится настоящий cross-origin consumer, для него нужен
отдельный явный origin/method/header policy, а не расширение текущего browser gateway.

Same-origin не отменяет CSRF: browser автоматически добавляет session cookie. RFC 10017 требует
proper CSRF defense; `SameSite=Strict` недостаточен, когда не все sibling subdomains доверены.
При CORS-based защите safelisted requests могут пройти без preflight, поэтому BFF следует требовать
custom header для browser API calls
([RFC 10017 §6.1.3.3](https://www.rfc-editor.org/rfc/rfc10017.html#section-6.1.3.3)). OWASP также
рекомендует framework CSRF mechanism, session-bound token/double-submit либо Fetch Metadata с
Origin fallback; `SameSite` — defense in depth, не универсальная замена
([OWASP CSRF Prevention](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html)).

Project baseline для unsafe methods (`POST`, `PUT`, `PATCH`, `DELETE`): проверить exact `Origin`
или `Sec-Fetch-Site` + fallback, требовать explicit CSRF/custom header и не иметь state-changing
`GET`. CORS gateway по умолчанию не публикует.

## 5. Когда нужен отдельный feature Route Handler

Официальные Next docs не предписывают «один gateway» или «route file на каждый Nest endpoint».
Они подтверждают обе primitive: Route Handler может proxy-ить 1:1 request, а также transform,
filter и aggregate несколько data sources
([Next.js: Manipulating data](https://nextjs.org/docs/app/guides/backend-for-frontend#manipulating-data)).
Граница ниже — project choice, выведенный из cohesion и security требований:

| Сценарий | Boundary |
|---|---|
| RSC initial read | direct `server-only` Nest adapter |
| Browser operation, wire contract 1:1 с Nest | constrained common gateway |
| Несколько Nest calls / aggregation | feature Route Handler |
| Backend DTO намеренно превращается в отдельный browser presentation DTO | feature Route Handler |
| Особая HTTP cache/revalidation, webhook/callback, download/stream | feature Route Handler |
| Простая progressive-enhancement form mutation без client server-state lifecycle | Server Action допустим; всё равно authn/authz per action |

Route Handlers являются публичными API и обязаны сами проверять access; Next рекомендует такую же
security строгость, как для внешнего endpoint
([Next.js authentication: Route Handlers](https://nextjs.org/docs/app/guides/authentication#route-handlers)).
GET Route Handlers в текущем Next по умолчанию dynamic, а специальные cache semantics задаются
явно; feature route нужен, когда browser contract действительно владеет иной cache policy
([Route Handler reference](https://nextjs.org/docs/app/api-reference/file-conventions/route#caching)).

Existing `/api/library/materials` соответствует feature-route критерию: он обслуживает browser
infinite query и возвращает presentation result, а не прозрачный Nest DTO. Простые будущие
authoring operations не требуют по одному pass-through file, если constrained gateway сохраняет
их method/path/body/status contract без reinterpretation.

## 6. Decision checklist до реализации

- [ ] Зафиксировать BFF как confidential Logto client; bearer/refresh token никогда не сериализуется browser-у.
- [ ] Решить Logto RSC refresh persistence через supported shared `sessionWrapper` или иной durable server session.
- [ ] Получать browser-exposed operation allowlist отдельно от полного OpenAPI.
- [ ] Разрешать только fixed Nest origin, known methods/paths/headers и ограниченный body.
- [ ] Добавить CSRF policy для unsafe gateway/feature routes и тесты cross-site rejection.
- [ ] Сохранить Nest authorization на каждом protected endpoint.
- [ ] Явно определить forwarding/cache/error policy и не пропускать upstream cookies/internal headers.
- [ ] Проверить RSC direct, gateway 1:1 и feature aggregation как три разные integration paths.
