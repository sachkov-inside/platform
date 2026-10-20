"use client";

import { useProductCommunityEntry } from "@/features/community-entry";
import { Button } from "@/shared/ui/button";

/** The server resolves the Product's configured group and current Account's admission. */
export function AccountProductCommunity({
  productId,
}: {
  readonly productId: string;
}) {
  const query = useProductCommunityEntry(productId, null, true);
  const entry = query.data?.ok === true ? query.data.value : null;
  if (query.isPending)
    return (
      <p className="mt-3 text-sm text-muted-foreground" role="status">
        Проверяем сообщество…
      </p>
    );
  if (query.isError || !query.data.ok)
    return (
      <Button
        variant="link"
        className="mt-2 px-0"
        onClick={() => void query.refetch()}
      >
        Повторить проверку сообщества
      </Button>
    );
  if (entry === null || entry.kind === "none") return null;
  if (
    entry.kind === "join" ||
    (entry.kind === "member" && entry.groupUrl !== undefined)
  )
    return (
      <Button asChild variant="outline" className="mt-3">
        <a
          href={entry.kind === "join" ? entry.botUrl : entry.groupUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          {entry.kind === "join"
            ? "Вступить в сообщество"
            : "Открыть сообщество"}
        </a>
      </Button>
    );
  return (
    <p className="mt-3 text-sm text-muted-foreground" role="status">
      {entry.kind === "link_telegram"
        ? "Подключите Telegram выше, чтобы вступить в сообщество."
        : entry.kind === "restricted"
          ? "Вступление в сообщество ограничено. Обратитесь в поддержку."
          : entry.kind === "member"
            ? "Вы в сообществе"
            : "Готовим доступ к сообществу…"}
    </p>
  );
}
