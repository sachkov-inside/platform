// @ts-check
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

/** @param {string} path */
const read = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const transport = {
  origin: read("infra/production/entry/haproxy-origin.cfg"),
  edge: read("infra/production/entry/haproxy-edge.cfg"),
  clients: read("infra/production/entry/non-public-clients.lst"),
  caddy: read("infra/production/host/Caddyfile"),
};

/** @param {typeof transport} config */
function assertTransport(config) {
  assert.match(config.origin, /bind 201\.24\.126\.23:8443 accept-proxy/u);
  assert.match(
    config.origin,
    /tcp-request connection reject unless \{ src 185\.125\.101\.90 \}/u,
    "validate the original socket peer in the connection phase",
  );
  assert.match(
    config.origin,
    /tcp-request session reject if \{ src -f \/etc\/inside-entry\/non-public-clients\.lst \}/u,
    "validate decoded client addresses in the session phase",
  );
  assert.match(
    config.origin,
    /server caddy 127\.0\.0\.1:443 source 127\.0\.0\.2 send-proxy-v2/u,
    "use a fixed backend and a dedicated local source",
  );
  assert.doesNotMatch(config.origin, /\bset-(?:dst|src)(?:-port)?\b/u);
  assert.match(config.caddy, /allow 127\.0\.0\.2\/32/u);
  assert.doesNotMatch(
    config.caddy,
    /allow (?:0\.0\.0\.0\/0|127\.0\.0\.0\/8|185\.)/u,
  );
  assert.match(config.caddy, /fallback_policy ignore/u);
  assert.match(
    config.edge,
    /acl inside_name req\.ssl_sni -i sachkov\.dev www\.sachkov\.dev inside\.sachkov\.dev auth\.sachkov\.dev/u,
  );
  assert.match(config.edge, /use_backend inside_origin if inside_name/u);
  assert.match(config.edge, /default_backend existing_subscription/u);
  assert.match(
    config.edge,
    /server origin 201\.24\.126\.23:8443 send-proxy-v2/u,
  );
  assert.match(config.edge, /server nginx 127\.0\.0\.1:14443 send-proxy-v2/u);
  assert.doesNotMatch(config.edge, /\b(?:ssl crt|accept-proxy)\b/u);
  for (const range of [
    "0.0.0.0/8",
    "10.0.0.0/8",
    "100.64.0.0/10",
    "127.0.0.0/8",
    "169.254.0.0/16",
    "172.16.0.0/12",
    "192.168.0.0/16",
    "224.0.0.0/4",
    "240.0.0.0/4",
    "::/96",
    "fc00::/7",
    "fe80::/10",
    "ff00::/8",
  ]) {
    assert.ok(
      config.clients.split("\n").includes(range),
      `missing non-public range ${range}`,
    );
  }
  // HAProxy maps IPv4 to IPv6 for ACL comparison: this prefix would deny every IPv4 client.
  assert.doesNotMatch(config.clients, /^::ffff:0:0\/96$/mu);
}

describe("production TLS entry transport contract", () => {
  it("keeps the original-peer, decoded-client and local-Caddy boundaries", () => {
    assertTransport(transport);
  });
  for (const [label, key, before, after] of /** @type {const} */ ([
    [
      "a claimed peer in the wrong phase",
      "origin",
      "tcp-request connection reject unless",
      "tcp-request session reject unless",
    ],
    [
      "a loopback client checked before decoding",
      "origin",
      "tcp-request session reject if",
      "tcp-request connection reject if",
    ],
    [
      "a widened Caddy metadata source",
      "caddy",
      "allow 127.0.0.2/32",
      "allow 127.0.0.0/8",
    ],
    [
      "an unfenced application backend",
      "edge",
      "use_backend inside_origin if inside_name",
      "default_backend inside_origin",
    ],
    [
      "a missing subscription fallback",
      "edge",
      "default_backend existing_subscription",
      "",
    ],
    ["a missing loopback denial", "clients", "127.0.0.0/8", ""],
    [
      "an ACL that rejects every IPv4 client",
      "clients",
      "::/96",
      "::/96\n::ffff:0:0/96",
    ],
    [
      "a backend controlled by PROXY destination",
      "origin",
      "server caddy 127.0.0.1:443",
      "server caddy 0.0.0.0:0",
    ],
  ])) {
    it(`rejects ${label}`, () => {
      assert.notEqual(transport[key].indexOf(before), -1);
      assert.throws(() =>
        assertTransport({
          ...transport,
          [key]: transport[key].replace(before, after),
        }),
      );
    });
  }
});
