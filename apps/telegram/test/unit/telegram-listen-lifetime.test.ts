import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { expect, it } from "vitest";
import { HttpLifetime } from "../../src/application/http-lifetime.js";
import { deferred } from "../support/deferred.js";

@Module({})
// oxlint-disable-next-line typescript/no-extraneous-class -- Nest requires a concrete module class for this owned native HTTP fixture.
class EmptyApplication {}

for (const host of ["127.0.0.1", "localhost"])
  it(`closes late native HTTP admission and settles cold Nest listen before Fastify close on ${host}`, async () => {
    const adapter = new FastifyAdapter();
    const app = await NestFactory.create<NestFastifyApplication>(
      EmptyApplication,
      adapter,
      {
        logger: false,
        abortOnError: false,
      },
    );
    const lifetime = new HttpLifetime(adapter.getInstance());
    const begun = deferred();
    let handled = 0;
    adapter.getInstance().get("/probe", () => {
      handled += 1;
      return { accepted: true };
    });
    const stopping = () => {
      lifetime.closeAdmission();
      begun.resolve();
    };
    adapter.getInstance().server.once("listening", stopping);
    try {
      await app.init();
      // deterministic-test-allow unit-io: owns an ephemeral loopback native Nest/Fastify listener; finally drains public lifetime and closes application.
      const listening = app.listen(0, host);
      void listening.catch((error: unknown) => begun.reject(error));
      await begun.promise;
      await listening;
      const address = adapter.getInstance().server.address();
      if (address === null || typeof address === "string")
        throw new Error("Missing listener");
      const hostname =
        address.family === "IPv6" ? `[${address.address}]` : address.address;
      // deterministic-test-allow unit-io: owns this ephemeral native loopback listener and fully consumes its response before public close in finally.
      const response = await fetch(`http://${hostname}:${address.port}/probe`);
      expect(response.status).toBe(503);
      expect(response.headers.get("connection")).toBe("close");
      expect(await response.json()).toEqual({
        error: "Service Unavailable",
        message: "Service Unavailable",
        statusCode: 503,
      });
      expect(handled).toBe(0);
      lifetime.beginStop();
      expect((await lifetime.drain()).failures).toEqual([]);
      expect(lifetime.isQuiescent()).toBe(true);
    } finally {
      adapter.getInstance().server.off("listening", stopping);
      lifetime.beginStop();
      await lifetime.drain();
      await app.close();
    }
  });
