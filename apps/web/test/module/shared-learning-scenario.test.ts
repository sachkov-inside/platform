import { expect, test } from "vitest";
import { learningHttpProduct } from "../../../../scenarios/learning-http.mjs";
import { mapLibraryDiscoveryResult } from "@/features/library-discovery/api/map-library-discovery-result";

test("the real Product mapper retains populated chapters, access and practice placement", () => {
  const result = mapLibraryDiscoveryResult(
    { ok: true, response: new Response(), body: learningHttpProduct("holder") },
    "product",
  );
  expect(result.kind).toBe("ready");
  if (result.kind !== "ready") throw new Error("Missing populated Product");
  expect(result.reference.name).toBe("Учебный курс: от идеи к выпуску");
  expect(
    result.chapters.map((chapter) => [
      chapter.name,
      chapter.materialIds.length,
      chapter.supplementaryMaterialIds?.length,
    ]),
  ).toEqual([
    ["Начало учебного проекта", 2, 1],
    ["Выпуск учебного проекта", 1, 0],
    ["Следующая учебная глава", 0, 0],
  ]);
  expect(result.chapters[0]?.tasks).toMatchObject([
    {
      code: "synthetic-project",
      title: "Учебный пример: покажи результат",
      availability: "available",
      afterMaterialId: result.items[1]?.materialId,
    },
  ]);
  expect(
    result.items.map((item) => [item.title, item.access, item.availability]),
  ).toEqual([
    ["Учебный пример: первый шаг", "free", "available"],
    ["Учебный пример: работа над проектом", "closed", "available"],
    ["Учебный пример: проверка выпуска", "closed", "available"],
    ["Учебный пример: памятка", "free", "available"],
  ]);
  const denied = mapLibraryDiscoveryResult(
    {
      ok: true,
      response: new Response(),
      body: learningHttpProduct("learner"),
    },
    "product",
  );
  expect(denied).toMatchObject({
    kind: "ready",
    items: [
      { availability: "available" },
      { availability: "locked" },
      { availability: "locked" },
      { availability: "available" },
    ],
  });
});
