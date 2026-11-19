import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  inspectSource,
  compareInventory,
} from "./check-lifecycle-boundaries.mts";

const path = "apps/web/src/features/example/view.tsx";
test("a direct effect in a new product component requires migration or a reviewed boundary", () => {
  const result = inspectSource(
    path,
    'import { useEffect } from "react"; export function View() { useEffect(connect, []); }',
  );
  assert.deepEqual(
    result.calls.map((call) => [call.kind, call.owner]),
    [["useEffect", "View"]],
  );
  assert.deepEqual(
    compareInventory(result, [], "final").map((d) => d.code),
    ["new-effect"],
  );
});

test("changing a named timer deadline also requires review when the call stays identical", () => {
  const pins = [{ path, owner: "", kind: "constant", name: "deadline" }];
  const before = inspectSource(
    path,
    "const deadline = 250; setTimeout(done, deadline);",
    pins,
  );
  const after = inspectSource(
    path,
    "const deadline = 0; setTimeout(done, deadline);",
    pins,
  );
  const rows = before.calls.map((c, i) => ({
    ...c,
    id: String(i),
    status: "reviewed-timer",
  }));
  assert.deepEqual(
    compareInventory(after, rows, "audit").map((d) => d.code),
    ["changed-timing-input", "missing-or-moved"],
  );
});

test("an ordered pair of frames needs review while a single animation loop keeps working", () => {
  /** @param {string} s */
  const scan = (s) => inspectSource(path, s).diagnostics.map((d) => d.code);
  assert.deepEqual(
    scan("requestAnimationFrame(() => { requestAnimationFrame(reveal); });"),
    ["nested-frame-review"],
  );
  assert.deepEqual(
    scan("function animate(){draw(); requestAnimationFrame(animate);}"),
    [],
  );
});

/** @param {string} src */
const codes = (src, filename = path) => {
  const result = inspectSource(filename, src);
  return compareInventory(result, [], "final").map((d) => d.code);
};
for (const [name, src, expected] of [
  [
    "aliased layout effect",
    'import {useLayoutEffect as attach} from "react"; attach(work,[]);',
    "new-effect",
  ],
  [
    "namespace and literal property",
    'import * as R from "react"; R["useEffect"](work,[]);',
    "new-effect",
  ],
  [
    "default and optional call",
    'import R from "react"; R.useInsertionEffect?.(work,[]);',
    "new-effect",
  ],
  [
    "a generic wrapper",
    'import {useEffect} from "react";function useWhatever(fn){useEffect(fn,[]);}',
    "new-effect",
  ],
  [
    "forwarding a hook",
    'import {useEffect as e} from "react";export const task=e;',
    "indirect-lifecycle-reference",
  ],
  [
    "forwarding a namespace",
    'import * as R from "react"; const saved=R;',
    "react-namespace-reference",
  ],
  [
    "computed namespace member",
    'import R from "react";R[key](work);',
    "computed-react-member",
  ],
  [
    "reexport from React",
    'export {useEffect as begin} from "react";',
    "react-reexport",
  ],
  ["namespace reexport", 'export * as R from "react";', "react-reexport"],
  [
    "forwarding an imported alias",
    'import {useEffect as e} from "react";export {e as hook};',
    "react-reexport",
  ],
  [
    "dynamic React import",
    'const R=await import("react");R.useEffect(fn,[]);',
    "indirect-react-import",
  ],
  [
    "require React",
    'const {useEffect:e}=require("react");e(fn,[]);',
    "indirect-react-import",
  ],
  ["an omitted delay", "window.setTimeout(done);", "ordering-timer"],
  ["zero delay", "setTimeout(done,0);", "ordering-timer"],
  [
    "an undefined delay",
    "globalThis['setTimeout'](done,undefined);",
    "ordering-timer",
  ],
  ["new debounce", "setTimeout(done, searchPause);", "new-timer-review"],
  ["polling", "setInterval(poll,3000);", "new-timer-review"],
  [
    "forwarding a timer",
    "const later=window.setTimeout;",
    "indirect-lifecycle-reference",
  ],
  [
    "destructuring a timer",
    "const {setTimeout: later}=globalThis;",
    "indirect-lifecycle-reference",
  ],
]) {
  test(name, () => assert.deepEqual(codes(src), [expected]));
}
test("type-only React, locals, derived state, handlers, callback refs and a query are permitted", () => {
  const src =
    'import type {useEffect} from "react"; export type {useLayoutEffect} from "react"; import {useMemo,useCallback} from "react"; function View({items}) {const result=useMemo(()=>items.filter(Boolean),[items]);const ref=useCallback(el=>el?.focus(),[]);useQuery(options);return <button ref={ref} onClick={()=>select(result)}/>;}';
  assert.deepEqual(codes(src), []);
  assert.deepEqual(
    codes('import {useEffect as name} from "react"; function f(name){name();}'),
    [],
  );
  assert.deepEqual(
    codes('import * as R from "react"; function f(R){R.useEffect();}'),
    [],
  );
});
test("exact approval binds path, owner, full body, dependencies and multiplicity; line numbers can change", () => {
  const src =
    'import {useEffect} from "react";function Viewer(){useEffect(()=>{open();return close;},[id]);}';
  /** @param {string} s */
  const scan = (s, p = path) => inspectSource(p, s);
  const row = {
    ...scan(src).calls[0],
    id: "approved-example",
    status: "approved-boundary",
    reason: "Closes the installed dialog",
    test: "viewer.stories.tsx",
  };
  /** @param {string} s @param {string} [p] */
  const check = (s, p) =>
    compareInventory(scan(s, p), [row], "final").map((d) => d.code);
  assert.deepEqual(check("// documentation\n" + src), []);
  assert.deepEqual(check(src.replace("open();", "open( ); /* open */")), []);
  for (const changed of [
    src.replace("Viewer", "Other"),
    src.replace("return close", "return anotherClose"),
    src.replace("[id]", "[]"),
  ])
    assert.deepEqual(check(changed), ["new-effect", "missing-or-moved"]);
  assert.deepEqual(check(src, "apps/web/src/other/view.tsx"), [
    "new-effect",
    "missing-or-moved",
  ]);
  assert.deepEqual(
    check(
      src.replace(
        "},[id]);",
        "},[id]);useEffect(()=>{open();return close;},[id]);",
      ),
    ),
    ["new-effect"],
  );
  assert.deepEqual(
    check(src.replace("useEffect(()=>{open();return close;},[id]);", "")),
    ["missing-or-moved"],
  );
  assert.deepEqual(
    check(
      src
        .replace("return close;", "return close;")
        .replace("[id]);", "[id]);useEffect(work,[]);"),
    ),
    ["new-effect"],
  );
});
test("unchanged observations cannot grant final effect permission", () => {
  const result = inspectSource(
    path,
    'import {useEffect} from "react";function E(){useEffect(run,[])}',
  );
  for (const status of [
    "retained-design",
    "frozen-blocked",
    "native-candidate",
  ]) {
    const row = { ...result.calls[0], id: "sample", status };
    assert.deepEqual(compareInventory(result, [row], "audit"), []);
    assert.deepEqual(
      compareInventory(result, [row], "final").map((d) => d.code),
      [status],
    );
  }
  assert.throws(
    () =>
      compareInventory(
        result,
        [{ ...result.calls[0], status: "reviewed-timer" }],
        "final",
      ),
    /cannot authorize/,
  );
});
test("batching exception applies to exactly one call, while a reviewed positive timeout remains valid", () => {
  const result = inspectSource(
    path,
    "function batch(){setTimeout(flush,0);}function search(){setTimeout(load,250);}",
  );
  const rows = result.calls.map((c, i) => ({
    ...c,
    id: "T" + i,
    status: i === 0 ? "reviewed-batch" : "reviewed-timer",
  }));
  assert.deepEqual(compareInventory(result, rows, "final"), []);
  const changed = inspectSource(
    path,
    "function batch(){setTimeout(other,0);}function search(){setTimeout(load,250);}",
  );
  assert.deepEqual(
    compareInventory(changed, rows, "final").map((d) => d.code),
    ["ordering-timer", "missing-or-moved"],
  );
});

test("direct import from the Node promise timers reads the delay from the first argument", () => {
  assert.deepEqual(
    codes(
      'import {setTimeout as pause} from "node:timers/promises"; pause(0,data);',
    ),
    ["ordering-timer"],
  );
  assert.deepEqual(
    codes('import * as t from "node:timers/promises"; t.setTimeout(350,data);'),
    ["new-timer-review"],
  );
});
test("React default forwarding and literal-computed keys retain the React binding", () => {
  assert.deepEqual(
    codes('import * as R from "react";R.default["use"+"Effect"](work,[]);'),
    ["new-effect"],
  );
  assert.deepEqual(codes('import * as R from "react";const alias=R.default;'), [
    "react-namespace-reference",
  ]);
});
test("moving a reviewed positive timer requests a new decision and identifies the removed call", () => {
  const src = "const schedule=()=>setTimeout(work,250);";
  const result = inspectSource(path, src);
  const rows = result.calls.map((c) => ({
    ...c,
    id: "test-timer",
    status: "reviewed-timer",
  }));
  assert.deepEqual(
    compareInventory(
      inspectSource("apps/web/src/app/view.tsx", src),
      rows,
      "audit",
    ).map((d) => d.code),
    ["new-timer-review", "missing-or-moved"],
  );
});

test("executable TypeScript namespaces, enums and module forwarding cannot hide a hook", () => {
  assert.deepEqual(
    codes(
      'import {useEffect} from "react";namespace Feature {export function Panel(){useEffect(work,[])}}',
    ),
    ["new-effect"],
  );
  assert.deepEqual(codes('import R = require("react");'), [
    "indirect-react-import",
  ]);
  assert.deepEqual(
    codes(
      'import {useEffect} from "react";enum State { active=useEffect(work,[]) }',
    ),
    ["new-effect"],
  );
  assert.deepEqual(
    codes('import type R = require("react"); type Work=typeof R.useEffect;'),
    [],
  );
});

test("CLI scans new production files in app and src, reports moves and preserves scoped exclusions", () => {
  const root = mkdtempSync(join(tmpdir(), "web-lifecycle-"));
  const sources = [
    "apps/web/app/new/page.tsx",
    "apps/web/src/features/nested/storybook/production.mts",
    "apps/web/src/use.test.production.ts",
    "apps/web/src/nested/generated/customer.ts",
    "apps/web/src/storybook/helper.ts",
    "apps/web/src/shared/api/backend/generated/model.ts",
    "apps/web/src/example.stories.tsx",
  ];
  try {
    for (const file of sources) {
      const target = join(root, file);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(
        target,
        'import {useEffect as attach} from "react";export function View(){attach(connect,[]);}',
      );
    }
    const cli = fileURLToPath(
      new URL("./check-lifecycle-boundaries.mts", import.meta.url),
    );
    const d19Story = join(
      root,
      "apps/web/src/_pages/library-discovery/ui/product-journey.stories.tsx",
    );
    mkdirSync(dirname(d19Story), { recursive: true });
    writeFileSync(d19Story, "");
    const result = spawnSync(process.execPath, [cli, "audit", root], {
      encoding: "utf8",
      timeout: 15_000,
    });
    assert.equal(result.status, 1, result.stderr);
    const report = z
      .object({
        effects: z.number(),
        findings: z.array(
          z.object({
            code: z.string(),
            path: z.string(),
            id: z.string().optional(),
            testPath: z.string().optional(),
          }),
        ),
      })
      .parse(JSON.parse(result.stdout));
    assert.equal(report.effects, 4);
    assert.deepEqual(
      report.findings
        .filter((f) => f.code === "new-effect")
        .map((f) => f.path)
        .sort(),
      sources.slice(0, 4).sort(),
    );
    assert.ok(report.findings.some((f) => f.code === "missing-or-moved"));
    assert.deepEqual(
      report.findings
        .filter((f) => f.code === "missing-boundary-test" && f.id === "D19")
        .map((f) => f.testPath),
      ["apps/web/test/navigation/product-reader-state.spec.ts"],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test("a verified named adapter needs the exact call, a reason and a public test", () => {
  const source =
    'import {useEffect} from "react";function useSearch(){useEffect(start,[query]);}';
  const result = inspectSource(path, source);
  const adapter = {
    ...result.calls[0],
    id: "D",
    status: "verified-adapter",
    reason: "Cancels an obsolete search delay",
    test: "search.stories.tsx",
  };
  assert.deepEqual(compareInventory(result, [adapter], "final"), []);
  for (const incomplete of [
    { ...adapter, reason: "" },
    { ...adapter, test: "" },
  ])
    assert.throws(
      () => compareInventory(result, [incomplete], "final"),
      /reason and a public test/,
    );
  assert.deepEqual(
    compareInventory(
      inspectSource(path, source.replace("[query]", "[]")),
      [adapter],
      "final",
    ).map((row) => row.code),
    ["new-effect", "missing-or-moved"],
  );
});
test("a migration or diagnostic disposition remains visible and blocking", () => {
  const result = inspectSource(
    path,
    'import {useEffect} from "react";function View(){useEffect(run,[]);}',
  );
  const row = {
    ...result.calls[0],
    id: "D",
    status: "retained-design",
    disposition: "diagnose",
    next: "Reproduce the still-active unload guard at the saved indicator.",
  };
  const [finding] = compareInventory(result, [row], "final");
  assert.equal(finding.code, "retained-design");
  assert.equal(finding.disposition, "diagnose");
  assert.equal(finding.next, row.next);
});

test("statically known React module names and runtime TypeScript aliases require review", () => {
  for (const expression of ["import(`react`)", 'require("re" + "act")']) {
    assert.deepEqual(
      codes("const {useEffect} = await " + expression + ";useEffect(work,[]);"),
      ["indirect-react-import"],
    );
  }
  assert.deepEqual(
    codes(
      'import * as R from "react"; import begin = R.useEffect; begin(work,[]);',
    ),
    ["indirect-lifecycle-reference"],
  );
  assert.deepEqual(
    codes('import * as R from "react"; type F = R.FunctionComponent;'),
    [],
  );
});
test("bigint literal values remain distinct in hook fingerprints", () => {
  const source = (/** @type {string} */ value) =>
    inspectSource(
      path,
      'import {useEffect} from "react"; useEffect(()=>store(' +
        value +
        "),[]);",
    );
  assert.deepEqual(
    compareInventory(source("123n"), [], "audit").map((x) => x.code),
    ["new-effect"],
  );
  assert.notEqual(
    source("123n").calls[0].fingerprint,
    source("124n").calls[0].fingerprint,
  );
  assert.notEqual(
    source("123n").calls[0].fingerprint,
    source('"123"').calls[0].fingerprint,
  );
});
test("computed timer keys cannot hide the timer and a constructed editor method is not a browser timer", () => {
  assert.deepEqual(
    codes('const {["set"+"Timeout"]: later}=window; later(done,0);'),
    ["indirect-lifecycle-reference"],
  );
  assert.deepEqual(
    codes("class Editor {setTimeout(){}} new Editor().setTimeout();"),
    [],
  );
});
test("a class name shadowed by another constructor cannot exempt a timer", () => {
  assert.deepEqual(
    codes(
      "class Editor {setTimeout(){}} function run(Editor){new Editor().setTimeout(work,0);}",
    ),
    ["ordering-timer"],
  );
  assert.deepEqual(
    codes(
      "class Editor {setTimeout(){window.setTimeout(work,0);}} new Editor().setTimeout();",
    ),
    ["ordering-timer"],
  );
});
test("review a directly scheduled second frame even after measuring; skip deferred event handlers", () => {
  assert.deepEqual(
    codes(
      "requestAnimationFrame(()=>{measure();if(ready)requestAnimationFrame(reveal);});",
    ),
    ["nested-frame-review"],
  );
  assert.deepEqual(
    codes(
      "requestAnimationFrame(()=>{button.onclick=()=>requestAnimationFrame(draw);});",
    ),
    [],
  );
});
