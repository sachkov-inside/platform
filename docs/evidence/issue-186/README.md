# Общая локальная приёмка медиа

Задача: [Platform #186](https://github.com/sachkov-inside/platform/issues/186).
База проверки: `43275923c6dde086b5fcf6a4cad1a39efcff0530`, 7 сентября 2026 года.
Owner functional/visual acceptance: **ожидается**. Этот протокол не закрывает задачу сам по себе.

## Проверяемое окружение

Node.js 24.19.0, pnpm 11.22.0; production-сборка Web, реальные Nest API/MCP, PostgreSQL и
MinIO. Тестовые подписанные Logto-сессии соответствуют разным Account. Только Kinescope и
его внешний player SDK заменены детерминированными адаптерами. На снимках `Test video`
обозначает подмену внешнего плеера, чёрное изображение — минимальный PNG для проверки доставки.
Это доказательство композиции и доступа, а не качества воспроизведения реального видео.

## Матрица

| Проверка | Исполняемое доказательство |
|---|---|
| Один public/membership Material содержит inline image, downloadable file и один primary Video | `material-authoring.spec.ts`: оба `media convergence`, desktop 1440×1024 и mobile 390×844 |
| Обычный active member получает image bytes, файл с точным содержимым и player; авторские права не участвуют | те же сценарии переключают owner на отдельный member Account |
| Anonymous: public media доступны, membership media скрыты | Reader плюс прямые file/playback endpoints; итоговое состояние `access-required` до проверки отсутствия bytes/iframe |
| Authenticated non-member, expired Membership, stale Membership evidence | реальные PostgreSQL Account/entitlement fixtures; Reader body/image/file/iframe отсутствуют, image/file endpoints → 404, playback → 403 без DRM token |
| Wrong Material, wrong Account/Profile, stale reference | новый playback запрос с чужим Material → 403; `material-authoring`, `videos`, `member-profiles` integration; `material-asset-delivery` unit |
| Подменённый/просроченный playback token, чужой provider ID | `video-playback.test.ts`; неверные provider locators отклоняет `kinescope-video-provider.test.ts` |
| Доступ проверяется до приватных locator, signed URL и provider request | `material-asset-delivery`, `video-playback`; full-stack playback gate и negative Reader network assertions |
| Кеш между пользователями | отдельный browser context **без routing**, разрешённая image navigation → sign-out → тот же URL возвращает 404/no-store; file deny no-store; version-bound Asset delivery и BFF header tests |
| Upload, chooser/paste/drop, Preview, publish, resume, replacement, retry | существующие full-stack `material-authoring` сценарии проходят вместе с общей композицией |
| Avatar upload, circular crop/keyboard zoom, remove/initials | `member-profile.spec.ts`; replacement, wrong Profile/Account, expired/stale access и reference-safe cleanup — `member-profiles.test.ts` |
| Storage outage, partial upload retry, replacement и cleanup race | `material-assets-object-storage.test.ts`, `material-asset-delivery.test.ts`, S3 conformance |
| Detach и external attachment не удаляют Kinescope object | full-stack UI не предлагает destructive action для attachment; forged delete отклоняется в PostgreSQL `material-authoring.test.ts` |
| Explicit deletion атомарна с Save и не удаляет referenced Video | `material-authoring.test.ts`, `videos.test.ts`: conflict/rollback, current/published references, duplicate/stale claims, terminal state, tombstone/late webhook |
| DELETE 200, trusted/unknown 404, timeout/network/429/5xx/400/401/403 | provider adapter tests и PostgreSQL deletion worker tests; реальные ответы Kinescope остаются #184 |
| Accessibility и layout | axe без serious/critical нарушений на совместном Reader; mobile overflow assertion; существующие avatar/editor/Reader axe, geometry и CLS checks |

Пути full-stack тестов: `apps/web/test/fullstack/`; PostgreSQL тестов:
`apps/backend/test/integration/`; unit/conformance: `apps/backend/test/unit/`.
Тесты отдельных слоёв названы явно: они не выдаются за реальный браузерный сбой провайдера.

## Архитектура и документация

`AssetsModule` и `MemberProfilesModule` импортируют один `ObjectStorageModule` и один
`OBJECT_STORAGE` port. Общая доменная Media entity и второй avatar storage adapter не добавлены.
MaterialBody schema запрещает inline Video; текущая и published-проекции хранят один nullable
`primaryVideoId`. Новый Reader test проверяет отсутствие нижнего дублирования «Ресурсы».
Исправлена устаревшая строка cardinality Video в [спецификации](../../specifications/platform-v1.md).
Контракт удаления остаётся в [runbook](../../runbooks/video-deletion.md).

## Снимки текущего прогона

| Состояние | Desktop | Mobile |
|---|---|---|
| Public image/file/video | [Снимок](public-desktop.png) | [Снимок](public-mobile.png) |
| Membership image/file/video | [Снимок](membership-desktop.png) | [Снимок](membership-mobile.png) |
| Отказ после выхода из аккаунта | [Снимок](denied-desktop.png) | [Снимок](denied-mobile.png) |
| Восстановление позиции player | [Снимок](player-resume-desktop.png) | [Снимок](player-resume-mobile.png) |
| Круглый crop и zoom аватара | [Снимок](avatar-crop-desktop.png) | [Снимок](avatar-crop-mobile.png) |
| Сохранённый аватар | [Снимок](avatar-account-desktop.png) | [Снимок](avatar-account-mobile.png) |
| Подтверждение удаления Video | [Снимок](video-delete-confirmation-desktop.png) | [Снимок](video-delete-confirmation-mobile.png) |
| Запрос удаления после Save | [Снимок](video-delete-requested-desktop.png) | [Снимок](video-delete-requested-mobile.png) |

## Проверки и ограничения

Код проверки: `595dc9a`; итоговые снимки сняты полным прогоном на этом commit.

- `pnpm check`: итоговый прогон прошёл; 412 backend и 448 web проверок, 43 browser route checks,
  build, standalone-config, Storybook build и архитектурные guardrails.
- `pnpm test:integration`: 30 файлов, 176 проверок прошли.
- `CAPTURE_EVIDENCE=1 pnpm smoke:fullstack`: прошёл на desktop/mobile, включая новую матрицу.
- Focused convergence и исправленные watched-сценарии: прошли на desktop/mobile.
- Standards: 0 нарушений; Spec: 0 оставшихся замечаний, повторное ревью от той же базы.
- Визуально просмотрены combined Reader, окончательный отказ, avatar crop и destructive confirmation.
- Host API/MCP/Web завершились штатно; Compose PostgreSQL/MinIO остановлены, volumes сохранены.

В полном browser suite остаются существующие пропуски: отдельные Telegram communications
сценарии требуют своего provider contour, а desktop-only layout checks не дублируются в mobile
project. Медиа-сценарии не пропущены.

Исправление устаревших selectors отметки «Просмотрено» относится к известному
[дефекту #344](https://github.com/sachkov-inside/platform/issues/344); production UI не менялся.

Для повтора нужны свободный singleton Compose и pinned toolchain; порядок владения окружением
описан в [local development runbook](../../runbooks/local-development.md).

```bash
pnpm check
pnpm test:integration
CAPTURE_EVIDENCE=1 pnpm smoke:fullstack
```

Реальные Kinescope playback/DRM, webhook/callback cadence, latency, provider outage и DELETE,
Yandex credentials, production CSP/privacy и Safari/iOS/Firefox здесь не проверены.
Предусмотренный no-captions scope сохранён. Browser checks покрывают Chromium desktop/mobile;
guardrails/CLS не заменяют измерения streaming performance у провайдера.
Production Kinescope acceptance остаётся отдельным
[release gate #184](https://github.com/sachkov-inside/platform/issues/184).
Merge, deploy, публикация и owner visual/functional GO этим прогоном не выполнялись.
