import type { Route } from "next";
import Link from "next/link";

import {
  AdminFilterBarSkeleton,
  AdminListHeader,
  AdminTableSkeleton,
} from "@/shared/ui/admin";
import { Button } from "@/shared/ui/button";

import {
  authoringDestinationHref,
  authoringMaterialsRootHref,
} from "../model/authoring-materials-query";
import { AuthoringMaterialsFrame } from "./authoring-materials-frame";
import {
  materialFilterCount,
  materialTableColumnCount,
} from "./authoring-materials-layout";

/**
 * Список материалов, пока данные идут: настоящий заголовок с кнопкой создания, строка фильтров и
 * таблица в своей геометрии. Пришедший список не сдвигает ни заголовок, ни начало таблицы.
 */
export function AuthoringMaterialsLoading() {
  return (
    <AuthoringMaterialsFrame busy label="Загрузка списка материалов">
      {/* Число записей занимает своё место и пока идёт загрузка: на телефоне заголовок с ним и
          кнопкой переносится на две строки, и пришедшее число его уже не переносит. */}
      <AdminListHeader
        action={<NewMaterialButton />}
        count="Загрузка…"
        title="Материалы"
      />
      <section
        className="grid grid-cols-[minmax(0,1fr)] gap-4"
        data-authoring-materials-list
      >
        <AdminFilterBarSkeleton filters={materialFilterCount} />
        <AdminTableSkeleton
          columns={materialTableColumnCount}
          label="Загружаем материалы"
        />
      </section>
    </AuthoringMaterialsFrame>
  );
}

/** Главная кнопка заголовка. Без запроса списка редактор возвращает к его началу. */
export function NewMaterialButton({
  returnHref = authoringMaterialsRootHref,
}: {
  readonly returnHref?: Route;
}) {
  return (
    <Button asChild className="min-h-11 px-4">
      <Link
        href={authoringDestinationHref("/authoring/materials/new", returnHref)}
      >
        Новый материал
      </Link>
    </Button>
  );
}
