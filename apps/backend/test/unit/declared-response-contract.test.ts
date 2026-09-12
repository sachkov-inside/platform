import { describe, expect, test } from "vitest";

import {
  assertDeclaredResponse,
  declaredServer,
  type DeclaredResponseParts,
  type InjectableServer,
} from "../support/declared-api.js";

// The personal home reaches its readers through strict schemas, so one key the projection never
// declared costs an account the whole body: it sees a Guide it has started as if it had not.
// `reading-activity-http.test.ts` reads its live responses against the generated OpenAPI document,
// and that check is only worth its place while an undeclared key still fails it. The document is
// the one owner of the shape, so this proof takes it from there instead of restating a schema.
describe("declared response contract", () => {
  const continuation = {
    collection: { cover: null, count: 3, id: "5a1c6f10-0b33-4e2f-9a8c-7d4e12b0f001", name: "Demo · Прогресс обучения", previewItems: [], slug: "demo-progress-series", summary: null },
    read: 1,
    total: 3,
    continuation: { materialSlug: "video-pro-developer-pipeline", resume: { kind: "start" } },
  };
  const learningHome = (series: unknown) => ({
    method: "GET",
    url: "/reading-activity/learning-home",
    status: 200,
    body: () => ({ video: null, series }),
  });
  const guideContinuation = (body: unknown) => ({
    method: "GET",
    url: "/reading-activity/guide-continuation/demo-progress-series",
    status: 200,
    body: () => body,
  });

  test("accepts the Guide continuation the module publishes", () => {
    expect(() => { assertDeclaredResponse(learningHome(continuation)); }).not.toThrow();
    expect(() => { assertDeclaredResponse(guideContinuation(continuation)); }).not.toThrow();
  });

  test("rejects a Guide field the collection does not declare", () => {
    const leaked = { ...continuation, collection: { ...continuation.collection, introduction: null } };
    expect(() => { assertDeclaredResponse(learningHome(leaked)); }).toThrow(/introduction/u);
    expect(() => { assertDeclaredResponse(guideContinuation(leaked)); }).toThrow(/introduction/u);
  });

  test("rejects a success the document never declared and an address it does not know", () => {
    expect(() => { assertDeclaredResponse({ ...learningHome(continuation), status: 299 }); })
      .toThrow(/does not declare/u);
    expect(() => { assertDeclaredResponse({ ...learningHome(continuation), url: "/reading-activity/series-continuation" }); })
      .toThrow(/declares no such address/u);
  });

  test("leaves a refusal from an address the document never declared alone", () => {
    expect(() => {
      assertDeclaredResponse({ ...learningHome(continuation), url: "/reading-activity/series-continuation", status: 404 });
    }).not.toThrow();
  });

  test("leaves a status the document answers without a body alone", () => {
    expect(() => {
      assertDeclaredResponse({
        method: "PUT",
        url: "/materials/9f1a/videos/2b7c/progress",
        status: 204,
        body: () => { throw new Error("body read"); },
      });
    }).not.toThrow();
  });

  // Негативная фикстура шва: сверку выполняет сам `inject`, а не только прямой вызов рядом.
  test("a leaking server fails the inject its test performed", async () => {
    const leaking: InjectableServer<DeclaredResponseParts> = {
      ready: () => Promise.resolve(),
      inject: () => Promise.resolve({
        statusCode: 200,
        json: () => ({ video: null, series: { ...continuation, collection: { ...continuation.collection, introduction: null } } }),
      }),
    };
    await expect(declaredServer(leaking).inject({ method: "GET", url: "/reading-activity/learning-home" }))
      .rejects.toThrow(/introduction/u);
  });


  // Отказ тоже объявленный ответ: `application/problem+json` описывает большую часть документа.
  // Расширять его тело контракт разрешает, поэтому проверяются состав обязательных полей и
  // объявленные значения, а не отсутствие чужих ключей.
  test("reads a declared refusal body instead of skipping it", () => {
    const problem = (code: string) => ({
      method: "POST",
      url: "/accounts/current/billing/quote",
      status: 409,
      body: () => ({ type: "about:blank", title: "Quote changed", status: 409, code }),
    });
    expect(() => { assertDeclaredResponse(problem("quote_changed")); }).not.toThrow();
    expect(() => { assertDeclaredResponse(problem("quote_vanished")); }).toThrow(/allowed values/u);
  });

  // Документ перечисляет варианты тела отказа через `oneOf`, и открытый вариант пересекается с
  // закрытым. Честное тело фильтра подходит обоим: «ровно один» отверг бы правильный ответ.
  test("accepts a refusal body that matches more than one declared variant", () => {
    expect(() => {
      assertDeclaredResponse({
        method: "PUT",
        url: "/reading-activity/materials/9f1a",
        status: 400,
        body: () => ({ type: "about:blank", title: "Bad request", status: 400, code: "invalid_request", detail: "materialId is not a UUID" }),
      });
    }).not.toThrow();
  });
});
