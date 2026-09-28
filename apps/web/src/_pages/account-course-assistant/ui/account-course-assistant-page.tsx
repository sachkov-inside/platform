import { notFound } from "next/navigation";

import {
  CourseAssistantPanel,
  repositoryConnectionOutcomeSchema,
} from "@/features/course-assistant-access";
import { loadCourseAssistantParticipant } from "@/features/course-assistant-access.server";
import {
  getPlatformAccessTokenRsc,
  readLogtoBffConfig,
} from "@/shared/auth/index.server";

/**
 * Помощник курса в кабинете (#787): экран первого использования и подключение репозитория.
 * Закрытый настройкой или allowlist помощник для этого Account не существует — 404.
 */
export async function AccountCourseAssistantPage({
  connection,
}: {
  readonly connection: string | undefined;
}) {
  const accessToken = await getPlatformAccessTokenRsc(readLogtoBffConfig());
  const load = await loadCourseAssistantParticipant(accessToken);
  if (load.kind === "unavailable") notFound();
  const outcome = repositoryConnectionOutcomeSchema.safeParse(connection);
  return (
    <div>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">Помощник курса</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Прототип: помощник проверяет практические задания по вашему
          репозиторию на GitHub.
        </p>
      </header>
      {load.kind === "failed" ? (
        <p
          className="rounded-xl border border-destructive/30 bg-destructive/6 p-4 text-sm leading-6"
          role="alert"
        >
          Не получилось загрузить помощника. Обновите страницу чуть позже.
        </p>
      ) : (
        <CourseAssistantPanel
          outcome={outcome.success ? outcome.data : undefined}
          participant={load.participant}
        />
      )}
    </div>
  );
}
