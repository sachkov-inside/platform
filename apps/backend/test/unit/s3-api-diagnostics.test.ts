import { expect, test } from "vitest";
import {
  assertPrivateS3Exports,
  summarizeS3Attempts,
} from "../support/s3-api-diagnostics.js";

const traceId = "a".repeat(32);
const rootId = "b".repeat(16);
const readId = "c".repeat(16);
const firstId = "d".repeat(16);
const privateValue = "private-diagnostic-sentinel";
function attribute(key: string, value: string | number) {
  return {
    key,
    value:
      typeof value === "string" ? { stringValue: value } : { intValue: value },
  };
}
function span(operation: string, id: string, parent: string, status?: number) {
  return {
    traceId,
    spanId: id,
    parentSpanId: parent,
    kind: operation === "getObject.read" ? 1 : 3,
    name: `s3 ${operation}`,
    attributes: [
      attribute("dependency.name", "s3"),
      attribute("dependency.operation", operation),
      attribute("dependency.outcome", status === 503 ? "failed" : "completed"),
      ...(status === undefined
        ? []
        : [
            attribute("http.request.method", "GET"),
            attribute("http.response.status_code", status),
          ]),
    ],
  };
}
function chain(nested = false) {
  return [
    { traceId, spanId: rootId, kind: 2, name: "GET /proof", attributes: [] },
    span("getObject.read", readId, rootId),
    span("http.GET", firstId, readId, 503),
    span("http.GET", "e".repeat(16), nested ? firstId : readId, 200),
  ];
}
function constantPrivacyFailure(
  input: unknown,
  secrets: readonly string[] = [],
) {
  let message = "";
  try {
    assertPrivateS3Exports(input, secrets);
  } catch (error) {
    message = error instanceof Error ? error.message : "unexpected";
  }
  expect(message === "S3 API privacy validation failed").toBe(true);
  expect(message.includes(privateValue)).toBe(false);
}

test("closed attempt counts distinguish sibling attempts, nested observation and ambiguous parents without identifiers", () => {
  const sibling = summarizeS3Attempts(chain());
  expect(
    sibling ===
      JSON.stringify([
        {
          operation: "getObject.read",
          outcome: "completed",
          status: "none",
          parentRole: "server",
          count: 1,
        },
        {
          operation: "http.GET",
          outcome: "completed",
          status: "200",
          parentRole: "read",
          count: 1,
        },
        {
          operation: "http.GET",
          outcome: "failed",
          status: "503",
          parentRole: "read",
          count: 1,
        },
      ]),
  ).toBe(true);
  const nested = summarizeS3Attempts(chain(true));
  expect(nested.includes('"parentRole":"http"')).toBe(true);
  const ambiguous = chain();
  ambiguous.push(span("getObject.read", readId, rootId));
  expect(summarizeS3Attempts(ambiguous).includes('"parentRole":"other"')).toBe(
    true,
  );
  for (const value of [traceId, rootId, readId, firstId])
    expect(sibling.includes(value)).toBe(false);
});

test("raw privacy gate rejects private values anywhere, signing material, malformed and oversized documents with one constant error", () => {
  assertPrivateS3Exports(['{"safe":true}'], [privateValue]);
  for (const input of [
    [JSON.stringify({ secret: privateValue })],
    [JSON.stringify({ [privateValue]: "value" })],
    [JSON.stringify({ nested: [privateValue] })],
    [
      JSON.stringify({ secret: privateValue }).replace(
        "private-",
        "\\u0070rivate-",
      ),
    ],
    ["{malformed"],
    ["🦀".repeat(262145)],
    ['{"header":"X-Amz-Signature=synthetic"}'],
    ['{"header":"AWS4-HMAC-SHA256"}'],
    ['{"header":"Credential=synthetic"}'],
    ['{"header":"Signature=synthetic"}'],
    [privateValue],
    [null],
    "not-an-array",
    Array.from({ length: 33 }, () => "{}"),
    ["x".repeat(1_048_577)],
    Array.from({ length: 5 }, () => "x".repeat(1_048_576)),
  ])
    constantPrivacyFailure(input, [privateValue]);
  constantPrivacyFailure(
    ["{}"],
    Array.from({ length: 65 }, () => "secret"),
  );
  constantPrivacyFailure(["{}"], ["x".repeat(2049)]);
  constantPrivacyFailure([
    JSON.stringify(Array.from({ length: 100_001 }, () => 0)),
  ]);
  let deep: unknown = 0;
  for (let level = 0; level < 34; level++) deep = { nested: deep };
  constantPrivacyFailure([JSON.stringify(deep)]);
});

test("privacy gate validates overwritten escaped tokens before duplicate members discard them", () => {
  const escaped = JSON.stringify(privateValue).replace(
    "private-",
    "\\u0070rivate-",
  );
  for (const raw of [
    `{"unknown":${escaped},"unknown":"safe"}`,
    `{"unknown":${escaped},"\\u0075nknown":"safe"}`,
    `{"outer":{"unknown":${escaped},"unknown":"safe"}}`,
    `{"unknown":{"hidden":${escaped}},"unknown":{}}`,
    `{"unknown":[{"name":${escaped}}],"unknown":[]}`,
    `{"header":"\\u0058-Amz-Signature=synthetic","header":"safe"}`,
    `{"unknown":${escaped},"unknown":`,
  ])
    constantPrivacyFailure([raw], [privateValue]);
  assertPrivateS3Exports(
    ['{"unknown":"first","\\u0075nknown":"safe"}'],
    [privateValue],
  );
  assertPrivateS3Exports(
    [JSON.stringify({ text: 'safe "quotes" { [ ] } \\ end' })],
    [privateValue],
  );
});

test("diagnostic output never serializes private fields, malformed attributes or unbounded input", () => {
  const original = chain();
  const poison: unknown[] = [
    null,
    {},
    "private-diagnostic-sentinel",
    Array.from({ length: 513 }, () => original[1]),
  ];
  for (const key of [
    "traceId",
    "spanId",
    "parentSpanId",
    "kind",
    "name",
    "attributes",
    "unknown",
  ]) {
    const value = { ...original[1], [key]: privateValue };
    poison.push([value]);
  }
  for (const key of ["key", "value", "unknown"]) {
    const attributes = [
      { ...attribute("dependency.name", "s3"), [key]: privateValue },
    ];
    poison.push([{ ...original[1], attributes }]);
  }
  poison.push([
    {
      ...original[1],
      attributes: [
        attribute("dependency.name", "s3"),
        attribute("dependency.name", "s3"),
      ],
    },
  ]);
  poison.push([
    {
      ...original[1],
      attributes: [
        attribute("dependency.name", "s3"),
        {
          key: "dependency.operation",
          value: { stringValue: privateValue, intValue: 200 },
        },
      ],
    },
  ]);
  poison.push([
    {
      ...original[1],
      attributes: Array.from({ length: 17 }, () =>
        attribute("dependency.name", "s3"),
      ),
    },
  ]);
  poison.push([{ ...original[1], name: "x".repeat(257) }]);
  for (const key of [
    "dependency.operation",
    "dependency.outcome",
    "http.request.method",
    "http.response.status_code",
  ]) {
    poison.push([
      {
        ...original[1],
        attributes: [
          attribute("dependency.name", "s3"),
          attribute(key, privateValue),
        ],
      },
    ]);
  }
  const throwing = Object.defineProperty({}, "traceId", {
    get() {
      throw new Error(privateValue);
    },
  });
  const unavailable = summarizeS3Attempts([throwing]);
  expect(unavailable === "S3 API diagnostic unavailable").toBe(true);
  for (const input of poison) {
    const output = summarizeS3Attempts(input);
    expect(output.includes(privateValue)).toBe(false);
    expect(output.length <= 8192).toBe(true);
    expect(JSON.stringify({ diagnostic: output }).includes(privateValue)).toBe(
      false,
    );
  }
  const unknown = span(privateValue, firstId, readId, 299);
  unknown.name = privateValue;
  unknown.attributes = [
    attribute("dependency.name", "s3"),
    attribute("dependency.operation", privateValue),
    attribute("dependency.outcome", privateValue),
    attribute("http.request.method", privateValue),
    attribute("http.response.status_code", 299),
  ];
  const output = summarizeS3Attempts([unknown]);
  expect(
    output ===
      JSON.stringify([
        {
          operation: "other",
          outcome: "other",
          status: "other",
          parentRole: "other",
          count: 1,
        },
      ]),
  ).toBe(true);
  expect(output.includes(privateValue)).toBe(false);
  const emptyStatus = {
    ...unknown,
    attributes: [
      attribute("dependency.name", "s3"),
      attribute("dependency.operation", "http.GET"),
      { key: "http.response.status_code", value: {} },
    ],
  };
  expect(summarizeS3Attempts([emptyStatus]).includes('"status":"other"')).toBe(
    true,
  );
  const wrongParentKind = chain().map((row, index) =>
    index === 1 ? { ...row, kind: 3 } : row,
  );
  expect(
    summarizeS3Attempts(wrongParentKind).includes('"parentRole":"other"'),
  ).toBe(true);
});
