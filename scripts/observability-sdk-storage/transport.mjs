// @ts-check
// Fixture-only passive observations. Experimental channels are pinned to Node26.10;
// missing events remain unknown. No listener consumes a response or sends a request.
import { subscribe, unsubscribe } from "node:diagnostics_channel";
import { ClientRequest, IncomingMessage } from "node:http";
import { isProxy } from "node:util/types";

const fields = /** @type {const} */ ([
  "createdMs",
  "submittedMs",
  "bodyFinishedMs",
  "headersMs",
  "endMs",
  "failureMs",
]);
/** @typedef {{createdMs:number|null,submittedMs:number|null,bodyFinishedMs:number|null,headersMs:number|null,endMs:number|null,failureMs:number|null}} Milestones */
/** @typedef {{available:true,sdkFlushMs:number|null,metrics:Milestones,traces:Milestones}|{available:false}} TransportSnapshot */
/** @returns {Milestones} */
const empty = () => ({
  createdMs: null,
  submittedMs: null,
  bodyFinishedMs: null,
  headersMs: null,
  endMs: null,
  failureMs: null,
});
/** @param {unknown} value @returns {TransportSnapshot} */
export function transportSnapshot(value) {
  try {
    if (typeof value !== "object" || value === null || isProxy(value))
      return { available: false };
    /** @param {object} object @param {string} key @returns {unknown} */
    const own = (object, key) =>
      Object.getOwnPropertyDescriptor(object, key)?.value;
    const keys = Reflect.ownKeys(value);
    if (
      keys.length !== 4 ||
      !keys.every(
        (key) =>
          typeof key === "string" &&
          ["available", "sdkFlushMs", "metrics", "traces"].includes(key),
      ) ||
      own(value, "available") !== true
    )
      return { available: false };
    /** @param {unknown} item @returns {item is number|null} */
    const time = (item) =>
      item === null ||
      (typeof item === "number" &&
        Number.isInteger(item) &&
        item >= 0 &&
        item <= 600000);
    const sdkFlushMs = own(value, "sdkFlushMs");
    if (!time(sdkFlushMs)) return { available: false };
    /** @param {unknown} input @returns {Milestones|null} */
    const row = (input) => {
      if (typeof input !== "object" || input === null || isProxy(input))
        return null;
      const keys = Reflect.ownKeys(input);
      if (
        keys.length !== fields.length ||
        !keys.every((key) => fields.some((field) => field === key))
      )
        return null;
      const result = empty();
      let prior = 0;
      for (const field of fields) {
        const item = own(input, field);
        if (!time(item)) return null;
        if (field !== "failureMs" && item !== null) {
          if (item < prior) return null;
          prior = item;
        }
        result[field] = item;
      }
      return result;
    };
    const metrics = row(own(value, "metrics")),
      traces = row(own(value, "traces"));
    return metrics === null || traces === null
      ? { available: false }
      : { available: true, sdkFlushMs, metrics, traces };
  } catch {
    return { available: false };
  }
}

/** @param {string} endpoint */
export function observeSdkTransport(endpoint) {
  const admitted = /^http:\/\/127\.0\.0\.1:([0-9]{1,5})$/u.exec(endpoint);
  const port = Number(admitted?.[1]);
  let available = admitted !== null && port > 0 && port <= 65535;
  let open = true;
  const started = performance.now();
  /** @type {number|null} */ let sdkFlushMs = null;
  /** @type {Record<"metrics"|"traces",{request:ClientRequest|null,row:Milestones,verified:boolean,failureMs:number|null}>} */
  const selected = {
    metrics: { request: null, row: empty(), verified: false, failureMs: null },
    traces: { request: null, row: empty(), verified: false, failureMs: null },
  };
  /** @type {(()=>void)[]} */ const removals = [];
  /** @returns {number|null} */
  const elapsed = () => {
    const value = Math.floor(performance.now() - started);
    return Number.isSafeInteger(value) && value >= 0 && value <= 600000
      ? value
      : null;
  };
  /** @param {()=>void} callback */
  const safe = (callback) => () => {
    if (!open || !available) return;
    try {
      callback();
    } catch {
      available = false;
    }
  };
  /** @param {import("node:events").EventEmitter} emitter @param {string} event @param {()=>void} callback */
  const once = (emitter, event, callback) => {
    const listener = safe(callback);
    removals.push(() => emitter.removeListener(event, listener));
    emitter.once(event, listener);
  };
  /** @param {unknown} message @returns {ClientRequest|null} */
  const requestFrom = (message) => {
    if (typeof message !== "object" || message === null || isProxy(message))
      return null;
    /** @type {unknown} */ const request = Object.getOwnPropertyDescriptor(
      message,
      "request",
    )?.value;
    return typeof request === "object" &&
      request !== null &&
      !isProxy(request) &&
      request instanceof ClientRequest
      ? request
      : null;
  };
  /** @param {unknown} message */
  const created = (message) => {
    try {
      if (!open || !available) return;
      const request = requestFrom(message);
      if (
        request === null ||
        request.method !== "POST" ||
        request.protocol !== "http:" ||
        request.host !== "127.0.0.1" ||
        request.getHeader("host") !== `127.0.0.1:${port}`
      )
        return;
      const signal =
        request.path === "/v1/metrics"
          ? "metrics"
          : request.path === "/v1/traces"
            ? "traces"
            : null;
      if (signal === null || selected[signal].request !== null) return;
      const entry = selected[signal];
      entry.request = request;
      entry.row.createdMs = elapsed();
      once(request, "finish", () => {
        entry.row.bodyFinishedMs = elapsed();
      });
      const verify = () => {
        const socket = request.socket;
        entry.verified =
          socket?.remoteAddress === "127.0.0.1" && socket.remotePort === port;
      };
      once(request, "socket", () => {
        const socket = request.socket;
        if (socket?.connecting) once(socket, "connect", verify);
        else verify();
      });
      // If an implementation publishes created after socket assignment, do not invent
      // a connect milestone; only actual peer identity can admit the stored times.
      if (request.socket !== null) {
        if (request.socket.connecting) once(request.socket, "connect", verify);
        else verify();
      }
    } catch {
      available = false;
    }
  };
  /** @param {unknown} message */
  const submitted = (message) => {
    try {
      if (!open || !available) return;
      const request = requestFrom(message);
      for (const entry of Object.values(selected))
        if (request !== null && entry.request === request)
          entry.row.submittedMs ??= elapsed();
    } catch {
      available = false;
    }
  };
  /** @param {unknown} message */
  const response = (message) => {
    try {
      if (!open || !available) return;
      const request = requestFrom(message);
      if (typeof message !== "object" || message === null) return;
      /** @type {unknown} */ const incoming = Object.getOwnPropertyDescriptor(
        message,
        "response",
      )?.value;
      if (
        typeof incoming !== "object" ||
        incoming === null ||
        isProxy(incoming)
      )
        return;
      if (!(incoming instanceof IncomingMessage)) return;
      for (const entry of Object.values(selected))
        if (
          request !== null &&
          entry.request === request &&
          entry.row.headersMs === null
        ) {
          entry.row.headersMs = elapsed();
          once(incoming, "end", () => {
            entry.row.endMs = elapsed();
          });
        }
    } catch {
      available = false;
    }
  };
  const channels = /** @type {const} */ ([
    ["http.client.request.created", created],
    ["http.client.request.start", submitted],
    ["http.client.response.finish", response],
  ]);
  try {
    if (available)
      for (const [name, listener] of channels) subscribe(name, listener);
  } catch {
    available = false;
  }
  return Object.freeze({
    enterFlush() {
      if (open && sdkFlushMs === null) sdkFlushMs = elapsed();
    },
    /** @param {string} signal */
    exportFailure(signal) {
      if (open && (signal === "metrics" || signal === "traces"))
        selected[signal].failureMs ??= elapsed();
    },
    /** @returns {TransportSnapshot} */
    snapshot() {
      return transportSnapshot({
        available,
        sdkFlushMs,
        ...Object.fromEntries(
          Object.entries(selected).map(([signal, entry]) => [
            signal,
            {
              ...(entry.verified ? entry.row : empty()),
              failureMs: entry.failureMs,
            },
          ]),
        ),
      });
    },
    close() {
      if (!open) return;
      open = false;
      for (const [name, listener] of channels) {
        try {
          unsubscribe(name, listener);
        } catch {
          available = false;
        }
      }
      for (const remove of removals) {
        try {
          remove();
        } catch {
          available = false;
        }
      }
      removals.length = 0;
      for (const entry of Object.values(selected)) entry.request = null;
    },
  });
}
