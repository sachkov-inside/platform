// @ts-check
// What a delivery requires of the machine it runs on (#1672): the pinned Node and a network that
// resolves trusted targets to their real addresses. Nothing here tunnels around a failure.
import { setDefaultResultOrder } from "node:dns";
import { lookup } from "node:dns/promises";
import { readFileSync } from "node:fs";
import { BlockList } from "node:net";
import { refusal } from "./refusal.mjs";

const pinnedNodePath = new URL("../../.node-version", import.meta.url);

/** The Node version Platform pins in `.node-version`. */
export const pinnedNode = () => readFileSync(pinnedNodePath, "utf8").trim();

/**
 * @param {string} [running]
 * @param {string} [pinned]
 */
export function assertPinnedNode(
  running = process.versions.node,
  pinned = pinnedNode(),
) {
  if (running !== pinned)
    throw refusal(
      "node_version",
      `Platform authoring requires Node ${pinned} (.node-version); this process runs ${running}. ` +
        `Run the command with that Node, for example: fnm exec --using ${pinned} pnpm --dir PLATFORM_CHECKOUT authoring:deliver ...`,
    );
}

// RFC 2544 benchmarking addresses: VPN clients hand them out as fake DNS answers.
const syntheticAddresses = new BlockList();
syntheticAddresses.addSubnet("198.18.0.0", 15, "ipv4");

/**
 * @typedef {(host: string) => Promise<{ address: string; family: number }[]>} ResolveHost
 */

/** @type {ResolveHost} */
const systemResolve = (host) => lookup(host, { all: true });

/**
 * Checks that each trusted host resolves to real addresses and makes IPv4 answers come first,
 * which is the supported configuration for the production edge (it publishes IPv4 only).
 *
 * @param {string[]} hosts
 * @param {ResolveHost} [resolve]
 */
export async function prepareTrustedNetwork(hosts, resolve = systemResolve) {
  setDefaultResultOrder("ipv4first");
  /** @type {Record<string, string[]>} */
  const resolved = {};
  for (const host of [...new Set(hosts)]) {
    /** @type {{ address: string; family: number }[]} */
    let addresses;
    try {
      addresses = await resolve(host);
    } catch (error) {
      throw refusal(
        "network_dns",
        `${host} does not resolve on this machine; check the network or VPN and repeat`,
        error,
      );
    }
    const fake = addresses.find(
      (entry) =>
        entry.family === 4 && syntheticAddresses.check(entry.address, "ipv4"),
    );
    if (fake !== undefined)
      throw refusal(
        "network_fake_dns",
        `${host} resolves to ${fake.address}, a VPN fake DNS address (198.18.0.0/15). ` +
          "Exclude sachkov.dev from the VPN's fake DNS (real-IP or direct rule) and repeat; the client does not relay around it",
      );
    resolved[host] = addresses.map((entry) => entry.address);
  }
  return resolved;
}
