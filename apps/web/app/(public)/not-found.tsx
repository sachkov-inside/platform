import { PageNotFound } from "@/_pages/route-states";

/** Документ или раздел публичной части не найден: оболочка уже стоит в раскладке. */
export default function PublicNotFound() {
  return (
    <>
      <title>Страница не найдена · Sachkov Inside</title>
      <PageNotFound />
    </>
  );
}
