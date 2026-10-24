import { PrismaPg } from "@prisma/adapter-pg";
import { Client, Pool } from "pg";
import {
  beginPostgresObservation,
  observePostgresPool,
} from "../observability/technical-telemetry.js";

const databasePoolPolicy = {
  max: 10,
  connectionTimeoutMillis: 5_000,
} as const;

/** This factory owns each pool before Prisma can retain it. No shared driver is patched. */
class ObservedPrismaPg extends PrismaPg {
  constructor(private readonly connectionString: string) {
    super({ connectionString, ...databasePoolPolicy });
  }

  override async connect(): ReturnType<PrismaPg["connect"]> {
    const pool = new Pool({
      connectionString: this.connectionString,
      ...databasePoolPolicy,
    });
    const observedClients = new WeakSet<Client>();
    const observeClient = (value: unknown) => {
      if (!(value instanceof Client) || observedClients.has(value)) return;
      observedClients.add(value);
      // Only clients first issued by this owned pool. Keep the original client/release identity.
      Object.defineProperty(value, "query", {
        configurable: true,
        enumerable: false,
        writable: true,
        // oxlint-disable-next-line typescript/unbound-method -- The Proxy forwards the original call-time receiver.
        value: observedMethod(value.query, "query"),
      });
    };
    Object.defineProperty(pool, "connect", {
      configurable: true,
      enumerable: false,
      writable: true,
      // oxlint-disable-next-line typescript/unbound-method -- The Proxy forwards the original call-time receiver.
      value: observedMethod(pool.connect, "acquire", observeClient, () =>
        observePostgresPool(pool, () => ({
          available: !pool.ending && !pool.ended,
          total: pool.totalCount,
          idle: pool.idleCount,
          waiting: pool.waitingCount,
        })),
      ),
    });
    try {
      return await new PrismaPg(pool, { disposeExternalPool: true }).connect();
    } catch (error) {
      try {
        await pool.end();
      } catch {
        /* Preserve the original factory failure. */
      }
      throw error;
    }
  }
}

/** Observe public callback/Promise completion without reading query arguments or error content. */
function observedMethod<Method extends (...args: never[]) => unknown>(
  method: Method,
  operation: "acquire" | "query",
  prepare: (value: unknown) => void = () => undefined,
  before: () => void = () => undefined,
): Method {
  return new Proxy(method, {
    apply(target, receiver: unknown, argumentsList: unknown[]) {
      const first = argumentsList[0];
      // Submittable streams have their own completion protocol, outside Prisma's query contract.
      if (
        operation === "query" &&
        typeof first === "object" &&
        first !== null &&
        "submit" in first
      ) {
        const result: unknown = Reflect.apply(target, receiver, argumentsList);
        return result;
      }
      before();
      const observation = beginPostgresObservation(operation);
      const args = [...argumentsList];
      const callback = args.at(-1);
      if (typeof callback === "function") {
        args[args.length - 1] = function (this: unknown, ...values: unknown[]) {
          const failed = values[0] !== undefined && values[0] !== null;
          if (!failed) prepare(values[1]);
          return observation.complete(failed, () => {
            const result: unknown = Reflect.apply(callback, this, values);
            return result;
          });
        };
      }
      try {
        const result: unknown = observation.run(() => {
          const value: unknown = Reflect.apply(target, receiver, args);
          return value;
        });
        if (typeof callback === "function") return result;
        if (result instanceof Promise) {
          return result.then(
            (value: unknown) => {
              prepare(value);
              return observation.complete(false, () => value);
            },
            (error: unknown) =>
              observation.complete(true, () => {
                throw error;
              }),
          );
        }
        return observation.complete(false, () => result);
      } catch (error) {
        return observation.complete(true, () => {
          throw error;
        });
      }
    },
  });
}

export function createPrismaPgAdapter(connectionString: string): PrismaPg {
  return new ObservedPrismaPg(connectionString);
}
