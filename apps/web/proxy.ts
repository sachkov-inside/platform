import { NextResponse, type NextRequest } from "next/server";

import { isLegalPagePath } from "@/_pages/legal.server";

/**
 * Адрес, у которого нет маршрута: папки с таким именем в `app/` нет, а корневого динамического
 * сегмента, который мог бы его поймать, тоже нет. Next.js отвечает на него, как на любой
 * неизвестный адрес: страница «не найдено», статус 404 и запрет кеширования — и для документа,
 * и для RSC. Прямой адрес `/_not-found` для этого не годится: Next.js отдаёт его как обычную
 * статическую страницу, RSC-запрос получает 200, а документ — кеш общих прокси на год.
 */
const UNROUTED_PATH = "/_unrouted";

/**
 * Неизвестный адрес юридического раздела отвечает 404 с первого захода (ADR 0027, #701). Адрес
 * вне `generateStaticParams` получает предсобранную оболочку и дорисовывается потоком, поэтому
 * `notFound()` страницы срабатывает уже после статуса 200. Здесь адрес сверяется со списком
 * опубликованных редакций до начала ответа; опубликованный проходит к своей статической странице
 * без изменений.
 */
export function proxy(request: NextRequest): NextResponse | undefined {
  if (isLegalPagePath(request.nextUrl.pathname)) return undefined;
  return NextResponse.rewrite(new URL(UNROUTED_PATH, request.url));
}

/** Только раздел документов: список его адресов известен web целиком, без запроса к backend. */
export const config = {
  matcher: "/legal/:path+",
};
