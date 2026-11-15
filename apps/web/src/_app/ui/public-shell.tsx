import type { ReactNode } from "react";

import { CourseMenuRestore } from "@/features/library-discovery";
import { AppShell } from "./app-shell";
import { PublicShellContent } from "./public-shell-content";
import { QueryProvider } from "./query-provider.client";

/**
 * Публичная оболочка целиком: шапка, навигация, сообщения о входе и уведомление о хранении.
 * Её надевают публичная раскладка и корневая страница «не найдено», которая стоит вне раскладки.
 */
export function PublicShell({ children }: { readonly children: ReactNode }) {
  return (
    <>
      <CourseMenuRestore />
      <QueryProvider>
        <AppShell>
          <PublicShellContent>{children}</PublicShellContent>
        </AppShell>
      </QueryProvider>
    </>
  );
}
