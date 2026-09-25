import type { ArgumentsHost } from "@nestjs/common";
import { HttpException, NotFoundException } from "@nestjs/common";
import { describe, expect, test } from "vitest";

import { problemException } from "../../src/infrastructure/http/problem-details.js";
import { ProblemDetailsFilter } from "../../src/infrastructure/http/problem-details.filter.js";

// Every problem response names its stable error code in `type`: `urn:inside:problem:<code>`, the
// code unchanged, as the web BFF answers too (owner decision on platform#732).
describe("Problem details", () => {
  test("an application error publishes its code as the problem type", () => {
    expect(problemException(404, "asset_not_found", "Asset not found").getResponse()).toEqual({
      code: "asset_not_found",
      status: 404,
      title: "Asset not found",
      type: "urn:inside:problem:asset_not_found",
    });
  });

  test("an exception without a problem body answers with its code as the type", () => {
    expect(send(new HttpException({ code: "video_not_found" }, 404))).toEqual({
      code: "video_not_found",
      status: 404,
      title: "Resource not found",
      type: "urn:inside:problem:video_not_found",
    });
    expect(send(new NotFoundException())).toEqual({
      code: "http_error",
      status: 404,
      title: "Resource not found",
      type: "urn:inside:problem:http_error",
    });
  });
});

function send(exception: HttpException): unknown {
  let body: unknown;
  const reply = {
    header: () => reply,
    send: (value: unknown) => {
      body = value;
      return reply;
    },
    status: () => reply,
    type: () => reply,
  };
  const host = { switchToHttp: () => ({ getResponse: () => reply }) };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- The filter reads only the HTTP response.
  new ProblemDetailsFilter().catch(exception, host as unknown as ArgumentsHost);
  return body;
}
