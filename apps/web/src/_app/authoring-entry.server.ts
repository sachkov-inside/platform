import "server-only";

import { notFound } from "next/navigation";
import { cache } from "react";
import { z } from "zod";

import { requestCurrentAccountPermissions } from "@/shared/api/backend/index.server";
import { readAuthenticatedSession } from "@/shared/auth/index.server";

const permissionsSchema = z.strictObject({ permissions: z.array(z.string()) });

/**
 * Вход в админку (#1879): её открывает аккаунт хотя бы с одним правом платформы, а права
 * отдельных разделов backend проверяет на каждом запросе. Гость и аккаунт без прав получают
 * страницу 404 без оболочки и навигации. Сбой проверки раздел не открывает: ошибку показывает
 * `app/error.tsx`.
 *
 * Layout не останавливает рендер страниц под ним: страница попала бы в ответ и без его
 * разрешения. Поэтому проверку вызывает и layout, и каждая страница раздела, а `cache` оставляет
 * один запрос прав на запрос страницы.
 */
export const requireAuthoringEntry = cache(async (): Promise<void> => {
  const session = await readAuthenticatedSession("rsc");
  if (session.kind === "authentication_required") notFound();
  if (session.kind !== "ready")
    throw new Error("Authoring entry: identity is unavailable");
  const result = await requestCurrentAccountPermissions(session.value);
  if (!result.ok) {
    if (result.response.status === 401) notFound();
    throw new Error(
      `Authoring entry: permissions read returned ${String(result.response.status)}`,
    );
  }
  const parsed = permissionsSchema.safeParse(result.body);
  if (!parsed.success)
    throw new Error("Authoring entry: permissions do not match the contract");
  if (parsed.data.permissions.length === 0) notFound();
});
