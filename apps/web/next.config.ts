import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { NextConfig } from "next";

const applicationDirectory = dirname(fileURLToPath(import.meta.url));
const isDevelopment = process.env.NODE_ENV === "development";
/**
 * `'unsafe-inline'` для скриптов остаётся и в production: оболочка страницы собирается без запроса
 * и не может нести nonce, а данные React, встроенные в поток ответа, меняются от запроса к запросу
 * и не описываются заранее посчитанным hash. Обоснование и условие пересмотра — ADR 0028.
 */
const scriptSources = isDevelopment
  ? "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://player.kinescope.io"
  : "script-src 'self' 'unsafe-inline' https://player.kinescope.io";
/** Хранилище стенда отдаёт превью по HTTP с локального адреса; production берёт картинки по HTTPS. */
const localImageSources = isDevelopment
  ? " http://127.0.0.1:* http://localhost:9000"
  : "";
const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  `img-src 'self' data: blob:${localImageSources} https://storage.yandexcloud.net https://*.storage.yandexcloud.net https://kinescope.io https://*.kinescope.io https://*.kinescopecdn.net`,
  "media-src 'self' blob: https://kinescope.io https://*.kinescope.io https://*.kinescopecdn.net",
  scriptSources,
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "connect-src 'self' https://kinescope.io https://*.kinescope.io https://*.kinescopecdn.net",
  "frame-src https://kinescope.io https://*.kinescope.io",
].join("; ");

/**
 * Индикатор режима разработки стоит внизу слева и, пока идёт рендер, разворачивается в плашку
 * «Rendering…» шириной 115 пикселей: x 20..135. Мобильный док на ширине 390 занимает x 80..310,
 * поэтому плашка накрывает центр левого пункта, и нажатие достаётся оверлею, а не ссылке.
 * Свёрнутый значок шириной 36 пикселей до дока не дотягивается — перекрытие даёт именно
 * развёрнутое состояние, и живёт оно ровно столько, сколько идёт рендер.
 *
 * Переставить индикатор в другой угол нельзя без новой платы: Next даёт только четыре угла, и
 * свободного среди них нет. На 390 оба нижних заняты снизу: публичный док на каждом маршруте, а на
 * страницах редактора ещё и его навигация `fixed inset-x-0 bottom-0`, которая доходит до края, так
 * что её левый пункт накрывает даже свёрнутый значок. Оба верхних на 1440 попадают в прилипшую
 * шапку — слева в ссылку «Sachkov Inside», справа в кнопку «Войти», — а их нажимают мышью, в
 * отличие от ссылки пропуска, которую видно лишь под фокусом. Менять перекрытие дока на
 * перекрытие шапки смысла нет.
 *
 * Поэтому индикатор гасится там, где человек работает с доком: на стенде Compose
 * (`config/compose/local/web.env`). Набор `pnpm test:e2e` идёт на production-сборке, где
 * индикатора нет вовсе (`playwright.config.ts`). Стенд —
 * основной режим разработки, и это осознанная смена исключения из задачи #567: владелец смотрит
 * платформу именно там. Запасной host `pnpm dev` запускается без переменной и индикатор
 * сохраняет — вместе с перекрытием, которое там остаётся.
 */
const hideDevIndicator = process.env.HIDE_DEV_INDICATOR === "true";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  /**
   * Навигация и кеширование — ADR 0027. Общая часть публичной страницы читается из `"use cache"`
   * с профилем `catalog`, личная стримится; `<Link>` предзагружает оболочку маршрута. Окно, в
   * котором браузер помнит страницу вместе с личной частью, страницы каталога объявляют сами
   * (`unstable_dynamicStaleTime`); у остальных маршрутов его нет.
   */
  cacheComponents: true,
  partialPrefetching: true,
  cacheLife: {
    /**
     * Общая запись живёт пять минут — столько владелец согласился ждать импорт, который идёт мимо
     * web. Обработчик кеша Next.js по умолчанию в production отдаёт запись ровно `revalidate`
     * секунд и дальше ждёт свежую, фонового обновления у него нет; `expire` обязан быть больше.
     */
    catalog: { stale: 300, revalidate: 300, expire: 600 },
    /** Отсутствующий адрес может появиться после публикации, поэтому «не найдено» живёт полминуты. */
    catalogMissing: { stale: 30, revalidate: 30, expire: 60 },
    /**
     * Сбой зависимости в кеше не задерживается. `expire` убирает запись из предсборки, нулевой
     * `stale` — из предзагрузки по намерению: иначе наведение на ссылку во время сбоя оставило бы
     * экран «недоступно» в памяти браузера и после того, как backend поднялся.
     */
    catalogUnavailable: { stale: 0, revalidate: 0, expire: 1 },
  },
  ...(hideDevIndicator ? { devIndicators: false as const } : {}),
  logging: {
    incomingRequests: { ignore: [/^\/callback(?:[/?]|$)/u] },
  },
  output: "standalone",
  outputFileTracingRoot: join(applicationDirectory, "../.."),
  poweredByHeader: false,
  /**
   * Прежний адрес формы контакта. Перенаправление живёт здесь, а не в маршруте: раздел
   * «Покупки» стримится, и редирект из страницы успел бы отдать каркас с кодом 200.
   */
  redirects: () =>
    Promise.resolve([
      {
        source: "/account/email",
        destination: "/account/purchases",
        permanent: true,
      },
    ]),
  headers: () =>
    Promise.resolve([
      {
        headers: [
          { key: "Content-Security-Policy", value: contentSecurityPolicy },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Content-Type-Options", value: "nosniff" },
        ],
        source: "/:path*",
      },
    ]),
  typedRoutes: true,
  typescript: {
    tsconfigPath: "tsconfig.next.json",
  },
};

export default nextConfig;
