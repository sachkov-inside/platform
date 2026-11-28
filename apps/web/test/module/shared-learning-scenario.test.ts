import { expect, test } from "vitest";
import {
  learningHttpProduct,
  learningHttpReader,
  learningHttpArtifacts,
} from "../../../../scenarios/learning-http.mjs";
import { mapLibraryDiscoveryResult } from "@/features/library-discovery/api/map-library-discovery-result";
import { renderedMaterialBodySchema } from "@/entities/material.model";
import { readInlineArtifactReference } from "@/features/product-artifacts.reader";
import { readerProductArtifactListSchema } from "@/features/product-artifacts/model/reader-product-artifacts";
import { learningReferenceReader } from "../fixtures/learning.fixtures";
import { learningInterceptionFile } from "../support/learning-interception";
import { z } from "zod";

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
      afterMaterialId: "97000000-0000-4000-8000-000000000012",
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

test("independent reader projections retain the declared inline file and exact bytes", () => {
  const response = z
    .object({ kind: z.literal("available"), body: renderedMaterialBodySchema })
    .parse(learningHttpReader("synthetic-reference", "holder"));
  const preview = learningReferenceReader();
  for (const blocks of [response.body.blocks, preview.body]) {
    const link = blocks
      .flatMap((block) => (block.kind === "paragraph" ? block.content : []))
      .find((text) => text.text === "Скачать шаблон результата (.txt)");
    expect(link).toMatchObject({
      marks: [
        {
          kind: "link",
          href: "/api/products/97000000-0000-4000-8000-000000000001/artifact-sources/synthetic-scenarios%3Aresult/file",
        },
      ],
    });
  }
  expect(
    readInlineArtifactReference(
      "/api/products/97000000-0000-4000-8000-000000000001/artifact-sources/synthetic-scenarios%3Aresult/file",
    ),
  ).toEqual({
    productId: "97000000-0000-4000-8000-000000000001",
    sourceId: "synthetic-scenarios:result",
  });
  expect(
    readerProductArtifactListSchema.parse(learningHttpArtifacts()).artifacts,
  ).toMatchObject([
    {
      sourceId: "synthetic-scenarios:result",
      content: { kind: "file", filename: "synthetic-result.txt" },
      availability: "available",
    },
  ]);
  expect(learningInterceptionFile()).toEqual({
    body: "Учебный результат: первый шаг и повторяемая проверка.\n",
    contentType: "text/plain",
    headers: {
      "content-disposition": 'attachment; filename="synthetic-result.txt"',
    },
  });
  expect(learningHttpReader("synthetic-project", "learner")).toMatchObject({
    kind: "teaser",
    access: { availability: "locked" },
  });
  expect(learningHttpReader("synthetic-project", "learner")).not.toHaveProperty(
    "body",
  );
});
