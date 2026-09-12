import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { NextConfig } from "next";

const applicationDirectory = dirname(fileURLToPath(import.meta.url));
const scriptSources = process.env.NODE_ENV === "development"
  ? "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://player.kinescope.io"
  : "script-src 'self' 'unsafe-inline' https://player.kinescope.io";
const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "img-src 'self' data: blob: http://127.0.0.1:* http://localhost:9000 https://storage.yandexcloud.net https://*.storage.yandexcloud.net https://kinescope.io https://*.kinescope.io https://*.kinescopecdn.net",
  "media-src 'self' blob: https://kinescope.io https://*.kinescope.io https://*.kinescopecdn.net",
  scriptSources,
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "connect-src 'self' https://kinescope.io https://*.kinescope.io https://*.kinescopecdn.net",
  "frame-src https://kinescope.io https://*.kinescope.io",
].join("; ");

/**
 * Индикатор режима разработки по умолчанию стоит внизу слева и, пока идёт рендер, разворачивается
 * в плашку «Rendering…» шириной 115 пикселей: x 20..135. Мобильный док на ширине 390 занимает
 * x 80..310, поэтому плашка накрывает центр левого пункта, и нажатие достаётся оверлею, а не
 * ссылке. Свёрнутый значок шириной 36 пикселей до дока не дотягивается — перекрытие даёт именно
 * развёрнутое состояние, и живёт оно ровно столько, сколько идёт рендер.
 *
 * Стенд Compose поднимает web в режиме разработки, то есть индикатор видит и человек. Нижние углы
 * заняты доком на каждом маршруте, верхние на / и /library свободны, поэтому индикатор переезжает
 * наверх слева и остаётся доступен. На /account он ложится на край кнопки разделов кабинета: она
 * не прилипшая, уезжает при прокрутке, и нажимать её центр это не мешает.
 *
 * Браузерные проверки взаимодействуют с доком и не читают индикатор, поэтому поднимают сервер
 * вовсе без него: тогда результат сценария не зависит ни от угла, ни от того, развернулась плашка
 * или нет. Переменную ставит `playwright.config.ts`.
 */
const hideDevIndicator = process.env.HIDE_DEV_INDICATOR === "1";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  devIndicators: hideDevIndicator ? false : { position: "top-left" },
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
  redirects: () => Promise.resolve([{
    source: "/account/email",
    destination: "/account/purchases",
    permanent: true,
  }]),
  headers: () => Promise.resolve([{
    headers: [
      { key: "Content-Security-Policy", value: contentSecurityPolicy },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "X-Content-Type-Options", value: "nosniff" },
    ],
    source: "/:path*",
  }]),
  typedRoutes: true,
  typescript: {
    tsconfigPath: "tsconfig.next.json",
  },
};

export default nextConfig;
