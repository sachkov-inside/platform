// @ts-check
// Only the telemetry bind lookup is substituted. Next, HTTP and diagnostics are real.
import { registerHooks } from "node:module";
const peer = new URL("./web-http-metrics-dns-peer.mjs", import.meta.url).href;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (
      specifier === "node:dns/promises" &&
      context.parentURL?.endsWith("/web-http-preload.mjs") === true
    )
      return { url: peer, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});
