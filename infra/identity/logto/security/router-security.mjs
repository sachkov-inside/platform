// Review artifact. Run inside the Logto image:
// node --experimental-vm-modules router-variants.mjs
// Reads installed package variants; does not apply patches or write files.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import vm from "node:vm";

process.env.NODE_ENV = "production";
const logtoRoot = process.env.LOGTO_ROOT ?? "/etc/logto";
const account = createRequire(path.join(logtoRoot, "packages/account/package.json"));
const domEntry = account.resolve("react-router-dom");
const domRoot = path.resolve(path.dirname(domEntry), "..");
const domRequire = createRequire(domEntry);
const reactRouterRequire = createRequire(domRequire.resolve("react-router"));
const routerEntry = reactRouterRequire.resolve("@remix-run/router");
const routerRoot = path.resolve(path.dirname(routerEntry), "..");
const React = domRequire("react");
const { renderToStaticMarkup } = domRequire("react-dom/server");
const mixed = ["//foo", "\\\\foo", "/\\foo", "\\/foo"];
const redirects = [
  "//localhost/foo", "\\\\localhost/foo", "/\\localhost/foo", "\\/localhost/foo",
];

async function loadVariant(root, file, esm) {
  const filename = path.join(root, file);
  const source = fs.readFileSync(filename, "utf8");
  const module = { exports: {} };
  const context = vm.createContext({
    module, exports: module.exports, require: createRequire(filename),
    console, URL, URLSearchParams, Request, Response, Headers,
    AbortController, DOMException, setTimeout, clearTimeout,
    process: { env: { NODE_ENV: "production" } },
  });
  if (!esm) {
    vm.runInContext(source, context, { filename, timeout: 1000 });
    return { api: module.exports, source };
  }
  assert.equal(typeof vm.SourceTextModule, "function", "Use --experimental-vm-modules");
  const entry = new vm.SourceTextModule(source, { context, identifier: filename });
  const imports = new Map();
  const require = createRequire(filename);
  await entry.link((name) => {
    if (imports.has(name)) return imports.get(name);
    const value = require(name);
    const keys = [...new Set([...Object.keys(value), "default"])];
    const dependency = new vm.SyntheticModule(keys, function () {
      for (const key of keys) this.setExport(key, key === "default" ? value : value[key]);
    }, { context });
    imports.set(name, dependency);
    return dependency;
  });
  await entry.evaluate({ timeout: 1000 });
  return { api: entry.namespace, source };
}

function receipt(file, count, source) {
  const digest = createHash("sha256").update(source).digest("hex");
  console.log(`${file}: ${count} cases passed; sha256=${digest}`);
}

async function boundedNavigation(instance, to) {
  let timeout;
  try {
    await Promise.race([
      instance.navigate(to),
      new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error("Navigation timed out")), 1000); }),
    ]);
    assert.equal(instance.state.location.pathname, "/foo");
    assert.equal(instance.state.errors, null);
  } finally {
    clearTimeout(timeout);
    instance.dispose();
  }
}

for (const file of ["dist/router.cjs.js", "dist/router.js", "dist/router.umd.js", "dist/router.umd.min.js"]) {
  const { api, source } = await loadVariant(routerRoot, file, file === "dist/router.js");
  for (const input of mixed) {
    assert.equal(JSON.stringify(api.resolvePath(input)), JSON.stringify({ pathname: "/foo", search: "", hash: "" }));
    const instance = api.createRouter({
      history: api.createMemoryHistory({ initialEntries: ["/home"] }),
      routes: [{ id: "home", path: "/home" }, { id: "foo", path: "/foo" }],
    }).initialize();
    await boundedNavigation(instance, input);
  }
  for (const input of redirects) {
    const instance = api.createRouter({
      history: api.createMemoryHistory({ initialEntries: ["/home"] }),
      routes: [
        { id: "home", path: "/home" },
        { id: "start", path: "/start", loader: () => api.redirect(input) },
        { id: "foo", path: "/foo" },
      ],
    }).initialize();
    await boundedNavigation(instance, "/start");
  }
  assert.equal(JSON.stringify(api.resolvePath("../next?q=1#part", "/first/current")),
    JSON.stringify({ pathname: "/first/next", search: "?q=1", hash: "#part" }));
  receipt(`@remix-run/router/${file}`, 13, source);
}

let expectedLinks;
for (const file of [
  "dist/react-router-dom.development.js", "dist/index.js", "dist/react-router-dom.production.min.js",
  "dist/umd/react-router-dom.development.js", "dist/umd/react-router-dom.production.min.js",
]) {
  const { api, source } = await loadVariant(domRoot, file, !file.includes("/umd/"));
  const inputs = ["//evil.test/foo", "\\\\evil.test/foo", "/\\evil.test/foo", "\\/evil.test/foo", "../next?q=1#part", "https://evil.test/foo"];
  const links = inputs.map((to) => renderToStaticMarkup(React.createElement(api.MemoryRouter,
    { initialEntries: ["/first/current"] }, React.createElement(api.Link, { to }, "link"))));
  expectedLinks ??= links;
  assert.deepEqual(links, expectedLinks, `${file}: Link rendering differs between variants`);
  receipt(`react-router-dom/${file}`, inputs.length, source);
}

// Server URL classification is private, so verify the exact delivered regular expression.
// This is source verification, not a claim of SSR constructor-injection protection.
for (const file of ["server.js", "server.mjs", "dist/server.js", "dist/server.mjs"]) {
  const source = fs.readFileSync(path.join(domRoot, file), "utf8");
  const expression = source.match(/ABSOLUTE_URL_REGEX\s*=\s*(\/[^\n]+\/[a-z]*);/)?.[1];
  assert.ok(expression, `${file}: missing ABSOLUTE_URL_REGEX`);
  const regex = vm.runInNewContext(expression, {}, { timeout: 1000 });
  for (const input of redirects) assert.equal(regex.test(input), true, `${file}: ${input}`);
  for (const input of ["/local", "\\local", "next"]) assert.equal(regex.test(input), false);
  assert.equal(regex.test("HTTPS://example.com"), true);
  receipt(`react-router-dom/${file}`, 8, source);
}
