// Keep the production command's fixed URLs intact while using an unoccupied test port.
// Real node:http still owns HTTP, connection failures and response-body timeouts.
import http from "node:http";
import { syncBuiltinESMExports } from "node:module";

const getHttp = http.get;
http.get = (url, options, onResponse) => getHttp(process.env.HEALTHCHECK_TEST_URL, {
  ...options,
  headers: { ...options.headers, "x-probe-url": url },
}, onResponse);
syncBuiltinESMExports();
