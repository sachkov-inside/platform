import { Eye } from "lucide-react";
import Link from "next/link";

import {
  authoringMaterialPreviewHref,
  authoringProductEditorHref,
} from "@/shared/routing/authoring";
import { Button } from "@/shared/ui/button";

/**
 * Переход из состава продукта в предпросмотр материала по маршруту этого продукта (#837).
 * Предпросмотр возвращает автора в редактор продукта. Для главы ссылка ведёт на её первый материал.
 */
export function MaterialPreviewLink({
  label,
  materialId,
  productId,
}: {
  readonly label: string;
  readonly materialId: string;
  readonly productId: string;
}) {
  return (
    <Button asChild className="size-10" size="icon" variant="ghost">
      <Link
        aria-label={label}
        href={authoringMaterialPreviewHref(
          materialId,
          authoringProductEditorHref(productId),
          productId,
        )}
        title={label}
      >
        <Eye aria-hidden="true" />
      </Link>
    </Button>
  );
}
