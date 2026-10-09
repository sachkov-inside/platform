import type { Metadata } from "next";
import { connection } from "next/server";

import { HomePage, readPublicHomeWithOfferTerms } from "@/_pages/home.server";
import { publicPageMetadata, siteLinkPreview } from "@/shared/link-preview";
import { readPublicSiteOrigin } from "@/shared/link-preview/index.server";

/**
 * Главная блокирующая и объявляет это сама: без `instant = false` режим разработки пишет в
 * консоль ошибку о непредсобранных данных. Next.js не даёт объявить его вместе с окном памяти
 * браузера, поэтому Главная окна не держит и на каждый переход читается заново (решение владельца
 * 09.10.2026, ADR 0027).
 */
export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  return publicPageMetadata(
    await readPublicSiteOrigin(),
    "website",
    siteLinkPreview(),
  );
}

/**
 * Главная блокирующая: закреп читается до первого экрана, без скелета всей страницы (#562), иначе
 * карточка продукта сдвигала бы ленту. Ждать при этом нечего — закреп одинаков для всех и приходит
 * из гостевого кеша, а не из запроса с cookie. Лента грузится внутри `HomePage` в своей границе.
 */
export default async function HomeRoute() {
  // У адреса без параметров предсборка прочитала бы закреп при сборке образа, где нет ни backend,
  // ни конфигурации среды выполнения. `connection()` оставляет чтение запросу.
  await connection();
  return <HomePage result={await readPublicHomeWithOfferTerms()} />;
}
