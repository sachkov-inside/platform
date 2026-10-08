import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpCommunityAuthorization } from "../../src/adapters/platform/http-community-authorization.adapter.js";
import { HttpNotificationAuthorization } from "../../src/adapters/platform/http-notification-authorization.adapter.js";
import { HttpActivationPlatform } from "../../src/adapters/platform/http-activation-platform.adapter.js";
import type { DispatchRequest } from "../../src/modules/notifications/notification-contract.js";
import type { DispatchAuthorizationRequest } from "../../src/modules/community/community-contract.js";

const request: DispatchAuthorizationRequest = {
  contractVersion: "inside.billing-dispatch.v1",
  operation: "dispatch.authorize",
  operationId: "00000000-0000-4000-8000-000000000001",
  dispatchId: "00000000-0000-4000-8000-000000000002",
  dispatchContractVersion: "inside.community-entitlement.v1",
  attemptId: "00000000-0000-4000-8000-000000000003",
  effectRef: "00000000-0000-4000-8000-000000000004",
  effect: "community.approve_join",
  payloadDigest: "a".repeat(64),
};

afterEach(() => vi.restoreAllMocks());

const notificationRequest: DispatchRequest = {
  contractVersion: "inside.notification-dispatch.v1",
  operationId: "00000000-0000-4000-8000-000000000005",
  deliveryOperationId: "00000000-0000-4000-8000-000000000006",
  deliveryRef: "00000000-0000-4000-8000-000000000008",
  commandRevision: 1,
  payloadDigest: "b".repeat(64),
  attemptRef: "00000000-0000-4000-8000-000000000007",
};

const consumers = [
  {
    name: "community",
    limit: 16_384,
    secret: "synthetic-community",
    valid: {
      contractVersion: request.contractVersion,
      operation: "dispatch.result",
      operationId: request.operationId,
      dispatchId: request.dispatchId,
      attemptId: request.attemptId,
      decision: { status: "denied", reason: "superseded" },
    },
    invoke: (fetcher: typeof fetch) =>
      new HttpCommunityAuthorization(
        "https://p/x",
        "synthetic-community",
        fetcher,
      ).authorize(request),
  },
  {
    name: "notifications",
    limit: 16_384,
    secret: "synthetic-notifications",
    valid: {
      ...notificationRequest,
      status: "denied",
      reason: "preference_disabled",
    },
    invoke: (fetcher: typeof fetch) =>
      new HttpNotificationAuthorization(
        "https://p/x",
        "synthetic-notifications",
        fetcher,
      ).authorize(notificationRequest),
  },
  {
    name: "activation",
    limit: 1_048_576,
    secret: "synthetic-activation",
    valid: {
      ok: true,
      value: {
        contractVersion: "inside.subscription-activation.v1",
        state: "unlinked",
      },
    },
    invoke: (fetcher: typeof fetch) =>
      new HttpActivationPlatform(
        "https://p/x",
        "synthetic-activation",
        fetcher,
      ).binding("identity-synthetic"),
  },
];

for (const consumer of consumers) {
  describe(`bounded HTTP response through ${consumer.name}`, () => {
    it("cancels a rejected content type without reading or retrying", async () => {
      const cancel = vi.fn();
      const fetcher = vi.fn<typeof fetch>(() =>
        Promise.resolve(
          new Response(new ReadableStream<Uint8Array>({ cancel }), {
            headers: { "content-type": "text/plain" },
          }),
        ),
      );
      await expect(consumer.invoke(fetcher)).resolves.toBeUndefined();
      expect(cancel).toHaveBeenCalledOnce();
      expect(fetcher).toHaveBeenCalledOnce();
    });

    it("bounds a stalled body by the request signal, even if cancellation stalls", async () => {
      const abort = new AbortController();
      const timeout = vi
        .spyOn(AbortSignal, "timeout")
        .mockReturnValue(abort.signal);
      const cancel = vi.fn(
        () =>
          new Promise<void>(() => {
            // Models a responder whose cancellation never settles.
          }),
      );
      let started: () => void = () => {
        // Assigned before the stream can pull.
      };
      const reading = new Promise<void>((resolve) => {
        started = resolve;
      });
      const stream = new ReadableStream<Uint8Array>({
        pull() {
          started();
        },
        cancel,
      });
      const fetcher = vi.fn<typeof fetch>((_url, init) => {
        expect(init?.signal).toBe(abort.signal);
        return Promise.resolve(
          new Response(stream, {
            headers: { "content-type": "application/json" },
          }),
        );
      });
      const result = consumer.invoke(fetcher);
      await reading;
      abort.abort(new DOMException("synthetic deadline", "TimeoutError"));
      await expect(result).resolves.toBeUndefined();
      expect(timeout).toHaveBeenCalledWith(5000);
      expect(cancel).toHaveBeenCalledOnce();
      expect(stream.locked).toBe(false);
      expect(fetcher).toHaveBeenCalledOnce();
    }, 1000);

    it("rejects a signal already aborted before the body arrives", async () => {
      const abort = new AbortController();
      abort.abort(new DOMException("synthetic abort", "AbortError"));
      vi.spyOn(AbortSignal, "timeout").mockReturnValue(abort.signal);
      const cancel = vi.fn();
      const stream = new ReadableStream<Uint8Array>({ cancel });
      await expect(
        consumer.invoke(() =>
          Promise.resolve(
            new Response(stream, {
              headers: { "content-type": "application/json" },
            }),
          ),
        ),
      ).resolves.toBeUndefined();
      expect(cancel).toHaveBeenCalledOnce();
      expect(stream.locked).toBe(false);
    });

    it("rejects an absent response body", async () => {
      await expect(
        consumer.invoke(() =>
          Promise.resolve(
            new Response(null, {
              headers: { "content-type": "application/json" },
            }),
          ),
        ),
      ).resolves.toBeUndefined();
    });

    it("counts UTF-8 bytes across chunks before parsing the domain response", async () => {
      // Transport must cancel on the byte limit without waiting for EOF or JSON parsing.
      const cancel = vi.fn();
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(Buffer.from(" ".repeat(consumer.limit - 1)));
          controller.enqueue(Buffer.from("é"));
        },
        cancel,
      });
      await expect(
        consumer.invoke(() =>
          Promise.resolve(
            new Response(stream, {
              headers: { "content-type": "application/json" },
            }),
          ),
        ),
      ).resolves.toBeUndefined();
      expect(cancel).toHaveBeenCalledOnce();
      expect(stream.locked).toBe(false);
    });

    it.each([0, 1])(
      "accepts exactly the byte limit and rejects one byte above: offset %s",
      async (offset) => {
        const json = JSON.stringify(consumer.valid);
        const wire =
          " ".repeat(consumer.limit - Buffer.byteLength(json) + offset) + json;
        const cancel = vi.fn();
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(Buffer.from(wire));
            if (offset === 0) controller.close();
          },
          cancel,
        });
        await expect(
          consumer.invoke(() =>
            Promise.resolve(
              new Response(stream, {
                headers: { "content-type": "application/json; charset=utf-8" },
              }),
            ),
          ),
        ).resolves.toEqual(offset === 0 ? consumer.valid : undefined);
        if (offset === 1) expect(cancel).toHaveBeenCalledOnce();
        expect(stream.locked).toBe(false);
      },
    );

    it.each([
      "invalid JSON",
      "truncated JSON",
      "stream error",
      "empty body",
      "foreign contract",
    ])("fails closed for %s", async (kind) => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          if (kind === "stream error") {
            controller.error(new Error("synthetic disconnect"));
            return;
          }
          const wire =
            kind === "invalid JSON"
              ? "not JSON"
              : kind === "truncated JSON"
                ? JSON.stringify(consumer.valid).slice(0, -1)
                : kind === "foreign contract"
                  ? "{}"
                  : "";
          controller.enqueue(Buffer.from(wire));
          controller.close();
        },
      });
      await expect(
        consumer.invoke(() =>
          Promise.resolve(
            new Response(stream, {
              headers: { "content-type": "application/json" },
            }),
          ),
        ),
      ).resolves.toBeUndefined();
      expect(stream.locked).toBe(false);
    });

    it("decodes a JSON body split across byte chunks and preserves request credentials", async () => {
      const bytes = Buffer.from(JSON.stringify(consumer.valid));
      const fetcher = vi.fn<typeof fetch>((_url, init) => {
        expect(init).toMatchObject({
          redirect: "error",
          headers: { authorization: `Bearer ${consumer.secret}` },
        });
        return Promise.resolve(
          new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                for (const byte of bytes)
                  controller.enqueue(Uint8Array.of(byte));
                controller.close();
              },
            }),
            { headers: { "content-type": "application/json" } },
          ),
        );
      });
      await expect(consumer.invoke(fetcher)).resolves.toEqual(consumer.valid);
      expect(fetcher).toHaveBeenCalledOnce();
    });
  });
}
