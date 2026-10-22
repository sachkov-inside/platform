import "server-only";

import { handleAuthenticatedMutation } from "@/shared/auth/index.server";

// Двоичная загрузка идёт потоком: третий аргумент выводит её из правила формы.
export function handleNoteUpload(request: Request) {
  return handleAuthenticatedMutation(
    request,
    () => Promise.resolve(new Response(null, { status: 204 })),
    {
      failureResponse: () => new Response(null, { status: 503 }),
      maxBytes: 1_024,
      mode: "stream",
    },
  );
}
