import { expect, test } from "vitest";
import { assembleEmailExportCapture } from "../integration/setup/email-export-capture.js";

const trace =
  '{"resourceSpans":[{"resource":{"attributes":[]},"scopeSpans":[]}]}';

test("retains each exact UTF8 payload once and accounts native retries without changing its bytes", () => {
  const capture = assembleEmailExportCapture();
  for (let attempt = 0; attempt < 6; attempt++) {
    const request = capture.begin("/v1/traces");
    expect(request).toBeDefined();
    expect(request?.write(Buffer.from(trace))).toBe(true);
    request?.complete();
  }
  capture.assertComplete({ traces: 6, metrics: 0, other: 0 });
  expect(capture.payloads()).toEqual([trace]);
  expect(capture.entries()).toEqual([
    { body: trace, signal: "traces", multiplicity: 6 },
  ]);
});

test("refuses a seventh identical native payload instead of silently dropping its request", () => {
  const capture = assembleEmailExportCapture();
  for (let attempt = 0; attempt < 7; attempt++) {
    const request = capture.begin("/v1/traces");
    request?.write(Buffer.from(trace));
    request?.complete();
  }
  expect(() =>
    capture.assertComplete({ traces: 7, metrics: 0, other: 0 }),
  ).toThrow("multiplicity_limit");
});

function submit(
  capture: ReturnType<typeof assembleEmailExportCapture>,
  body: string | Buffer,
  path = "/v1/traces",
) {
  const request = capture.begin(path);
  request?.write(typeof body === "string" ? Buffer.from(body) : body);
  request?.complete();
}
const numbered = (value: number) => `{"resourceSpans":[],"value":${value}}`;

test("refuses the 33rd distinct payload when two admitted requests finish across the parallel quota boundary", async () => {
  const capture = assembleEmailExportCapture();
  for (let value = 0; value < 31; value++) submit(capture, numbered(value));
  const first = capture.begin("/v1/traces");
  const second = capture.begin("/v1/traces");
  first?.write(Buffer.from(numbered(31)));
  second?.write(Buffer.from(numbered(32)));
  await Promise.all([
    Promise.resolve().then(() => first?.complete()),
    Promise.resolve().then(() => second?.complete()),
  ]);
  expect(capture.payloads()).toHaveLength(32);
  expect(() =>
    capture.assertComplete({ traces: 33, metrics: 0, other: 0 }),
  ).toThrow("distinct_limit");
});

test("refuses a fifth in-flight body and releases the four admitted fixed buffers", () => {
  const capture = assembleEmailExportCapture();
  const open = Array.from({ length: 4 }, () => capture.begin("/v1/traces"));
  expect(capture.summary().activeBodyBytes).toBe(4 * 1024 * 1024);
  expect(capture.begin("/v1/traces")).toBeUndefined();
  for (const request of open) {
    request?.write(Buffer.from(trace));
    request?.complete();
  }
  expect(capture.summary().active).toBe(0);
  expect(capture.summary().activeBodyBytes).toBe(0);
  expect(() =>
    capture.assertComplete({ traces: 5, metrics: 0, other: 0 }),
  ).toThrow("inflight_limit");
});

test("refuses oversized input before copying or truncating a body", () => {
  const capture = assembleEmailExportCapture();
  const request = capture.begin("/v1/traces");
  expect(request?.write(Buffer.alloc(1024 * 1024 + 1, 32))).toBe(false);
  request?.abort();
  expect(capture.payloads()).toEqual([]);
  expect(() =>
    capture.assertComplete({ traces: 1, metrics: 0, other: 0 }),
  ).toThrow("body_limit");
});

test("refuses unknown routes instead of misclassifying their bytes as traces", () => {
  const capture = assembleEmailExportCapture();
  expect(capture.begin("/private-unknown-route")).toBeUndefined();
  expect(() =>
    capture.assertComplete({ traces: 0, metrics: 0, other: 1 }),
  ).toThrow("unknown_route");
  expect(JSON.stringify(capture.summary())).not.toContain(
    "private-unknown-route",
  );
});

test("refuses malformed JSON and does not retain input or parse-error text in diagnostics", () => {
  const capture = assembleEmailExportCapture();
  submit(capture, '{"private-body-sentinel":');
  expect(capture.payloads()).toEqual([]);
  expect(() =>
    capture.assertComplete({ traces: 1, metrics: 0, other: 0 }),
  ).toThrow("malformed");
  expect(JSON.stringify(capture.summary())).not.toContain(
    "private-body-sentinel",
  );
});

test("refuses total request saturation beyond 32 distinct payloads with six native attempts each", () => {
  const capture = assembleEmailExportCapture();
  for (let value = 0; value < 32; value++)
    for (let attempt = 0; attempt < 6; attempt++)
      submit(capture, numbered(value));
  capture.assertComplete({ traces: 192, metrics: 0, other: 0 });
  expect(capture.begin("/v1/traces")).toBeUndefined();
  expect(() =>
    capture.assertComplete({ traces: 193, metrics: 0, other: 0 }),
  ).toThrow("request_limit");
});

test("refuses double completion instead of manufacturing or hiding a request multiplicity", () => {
  const capture = assembleEmailExportCapture();
  const request = capture.begin("/v1/traces");
  request?.write(Buffer.from(trace));
  request?.complete();
  request?.complete();
  expect(() =>
    capture.assertComplete({ traces: 1, metrics: 0, other: 0 }),
  ).toThrow("lifecycle");
});

test("keeps a one-byte difference and JSON whitespace as distinct evidence", () => {
  const capture = assembleEmailExportCapture();
  const first = '{"resourceSpans":[],"marker":"a"}';
  const second = '{"resourceSpans":[],"marker":"b"}';
  for (const body of [first, second, `${first} `]) submit(capture, body);
  capture.assertComplete({ traces: 3, metrics: 0, other: 0 });
  expect(capture.payloads()).toEqual([first, second, `${first} `]);
});

test("retains a late sentinel in the 32nd distinct body after 186 earlier native attempts", () => {
  const capture = assembleEmailExportCapture();
  for (let value = 0; value < 31; value++)
    for (let attempt = 0; attempt < 6; attempt++)
      submit(capture, numbered(value));
  const sentinel = "late-private-email-sentinel@example.test";
  const body = JSON.stringify({
    resourceSpans: [],
    padding: "x".repeat(1_048_400),
    tail: sentinel,
  });
  submit(capture, body);
  capture.assertComplete({ traces: 187, metrics: 0, other: 0 });
  expect(capture.payloads()).toHaveLength(32);
  expect(() => {
    for (const payload of capture.payloads())
      expect(payload).not.toContain(sentinel);
  }).toThrow();
});

test("admits an exact byte-limit payload and counts repeats when all 32 distinct slots are occupied", () => {
  const capture = assembleEmailExportCapture();
  const prefix = '{"resourceSpans":[],"padding":"';
  const suffix = '"}';
  const body =
    prefix + "x".repeat(1024 * 1024 - prefix.length - suffix.length) + suffix;
  submit(capture, body);
  for (let value = 1; value < 32; value++) submit(capture, numbered(value));
  submit(capture, body);
  capture.assertComplete({ traces: 33, metrics: 0, other: 0 });
  expect(capture.payloads()).toHaveLength(32);
  expect(capture.entries()[0]?.multiplicity).toBe(2);
  expect(Buffer.byteLength(capture.payloads()[0] ?? "")).toBe(1024 * 1024);
});

test("validates UTF8 after all chunks without replacing a split multibyte codepoint", () => {
  const capture = assembleEmailExportCapture();
  const body = '{"resourceSpans":[],"value":"é"}';
  const bytes = Buffer.from(body);
  const split = bytes.indexOf(0xc3) + 1;
  const request = capture.begin("/v1/traces");
  request?.write(bytes.subarray(0, split));
  request?.write(bytes.subarray(split));
  request?.complete();
  capture.assertComplete({ traces: 1, metrics: 0, other: 0 });
  expect(capture.payloads()).toEqual([body]);
});

test.each([
  Buffer.from([0xc0, 0xaf]),
  Buffer.from([0xff]),
  Buffer.from([0xe2, 0x82]),
  Buffer.concat([Buffer.from(trace), Buffer.from([0xff])]),
])(
  "refuses malformed UTF8 instead of merging replacement-decoded bytes %j",
  (bytes) => {
    const capture = assembleEmailExportCapture();
    submit(capture, bytes);
    expect(capture.payloads()).toEqual([]);
    expect(() =>
      capture.assertComplete({ traces: 1, metrics: 0, other: 0 }),
    ).toThrow("malformed");
  },
);

test("does not strip a leading BOM to merge a different byte sequence", () => {
  const capture = assembleEmailExportCapture();
  submit(capture, trace);
  submit(
    capture,
    Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(trace)]),
  );
  expect(capture.entries()[0]?.multiplicity).toBe(1);
  expect(() =>
    capture.assertComplete({ traces: 2, metrics: 0, other: 0 }),
  ).toThrow("malformed");
});

test("keeps BOM inside JSON strings and Unicode normalization differences byte-distinct", () => {
  const capture = assembleEmailExportCapture();
  const bodies = ["é", "e\u0301", "\uFEFF"].map((value) =>
    JSON.stringify({ resourceSpans: [], value }),
  );
  for (const body of bodies) submit(capture, body);
  capture.assertComplete({ traces: 3, metrics: 0, other: 0 });
  expect(capture.payloads()).toEqual(bodies);
});

test.each([
  ["/v1/traces", '{"resourceMetrics":[]}'],
  ["/v1/metrics", '{"resourceSpans":[]}'],
  ["/v1/traces", '{"resourceSpans":[],"resourceMetrics":[]}'],
  ["/v1/traces", '{"resourceSpans":"private-body"}'],
  ["/v1/traces", "null"],
])("refuses signal/body mismatch and malformed envelopes %s", (path, body) => {
  const capture = assembleEmailExportCapture();
  submit(capture, body, path);
  expect(capture.payloads()).toEqual([]);
  expect(() =>
    capture.assertComplete({
      traces: path === "/v1/traces" ? 1 : 0,
      metrics: path === "/v1/metrics" ? 1 : 0,
      other: 0,
    }),
  ).toThrow("malformed");
});

test("accounts every aborted/incomplete request and frees its body buffer", () => {
  const capture = assembleEmailExportCapture();
  const request = capture.begin("/v1/traces");
  request?.write(Buffer.from(trace));
  request?.abort();
  request?.abort(); // HTTP aborted/error/close can all observe the same aborted request.
  expect(capture.summary().active).toBe(0);
  expect(capture.summary().aborted).toEqual({
    traces: 1,
    metrics: 0,
    other: 0,
  });
  expect(() =>
    capture.assertComplete({ traces: 1, metrics: 0, other: 0 }),
  ).toThrow("incomplete");
});

test("refuses an open request and any mismatch with independently observed signal request totals", () => {
  const open = assembleEmailExportCapture();
  const request = open.begin("/v1/traces");
  expect(() =>
    open.assertComplete({ traces: 1, metrics: 0, other: 0 }),
  ).toThrow("accounting");
  request?.abort();
  const capture = assembleEmailExportCapture();
  submit(capture, trace);
  expect(() =>
    capture.assertComplete({ traces: 0, metrics: 1, other: 0 }),
  ).toThrow("accounting");
});

test("fails closed on socket saturation and HTTP parser/transport failures without retaining their data", () => {
  const capture = assembleEmailExportCapture();
  capture.connectionSaturation();
  capture.transportFailure();
  expect(() =>
    capture.assertComplete({ traces: 0, metrics: 0, other: 0 }),
  ).toThrow("socket_limit");
  expect(capture.summary().violations).toMatchObject({
    socket_limit: 1,
    transport: 1,
  });
});

test("preserves a complete signal-category multiset across distinct metric and trace payloads", () => {
  const capture = assembleEmailExportCapture();
  submit(capture, trace);
  submit(capture, trace);
  submit(capture, '{"resourceMetrics":[]}', "/v1/metrics");
  capture.assertComplete({ traces: 2, metrics: 1, other: 0 });
  expect(capture.summary().completed).toEqual({
    traces: 2,
    metrics: 1,
    other: 0,
  });
  expect(
    capture
      .entries()
      .map(({ signal, multiplicity }) => ({ signal, multiplicity })),
  ).toEqual([
    { signal: "traces", multiplicity: 2 },
    { signal: "metrics", multiplicity: 1 },
  ]);
});
