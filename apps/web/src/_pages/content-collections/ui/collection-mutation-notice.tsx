import { Button } from "@/shared/ui/button";
import type { ContentCollectionMutationResult } from "../model/content-collections";
export function MutationNotice({
  onRefresh,
  result,
}: {
  readonly onRefresh: () => void;
  readonly result: ContentCollectionMutationResult | null;
}) {
  if (result === null) return null;
  if (result.kind === "saved")
    return (
      <p className="mt-4 text-sm font-semibold" role="status">
        Изменения сохранены.
      </p>
    );
  if (result.kind === "conflict") {
    return (
      <div className="mt-4 rounded-xl bg-muted p-4 text-sm" role="alert">
        <p className="font-semibold">Запись изменилась в другой вкладке.</p>
        <Button
          className="mt-3"
          onClick={onRefresh}
          size="sm"
          type="button"
          variant="outline"
        >
          Загрузить актуальную версию
        </Button>
      </div>
    );
  }
  const message =
    result.kind === "slug_conflict"
      ? "Такой slug уже занят. Выберите другой."
      : result.kind === "invalid"
        ? "Проверьте название, slug и длину описания."
        : result.kind === "unauthorized"
          ? "Сессия завершилась или права изменились."
          : `Не удалось сохранить. Код: ${result.reference}`;
  return (
    <p className="mt-4 rounded-xl bg-destructive/6 p-4 text-sm" role="alert">
      {message}
    </p>
  );
}
