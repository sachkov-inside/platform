import type { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { describe, expect, test, vi } from "vitest";

import { createS3ObjectStorage } from "../../src/infrastructure/object-storage/s3-object-storage.js";

describe("S3 object storage adapter", () => {
  test("maps namespaces and enforces immutable writes without leaking SDK types", async () => {
    const send = vi
      .fn<(command: DeleteObjectCommand | GetObjectCommand | PutObjectCommand) => Promise<unknown>>()
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce({ $metadata: { httpStatusCode: 412 }, name: "PreconditionFailed" });
    const storage = createS3ObjectStorage(
      {
        buckets: {
          protected: "inside-protected",
          public: "inside-public",
          quarantine: "inside-quarantine",
        },
        credentials: { accessKeyId: "access", secretAccessKey: "secret" },
        endpoint: "https://storage.yandexcloud.net",
        forcePathStyle: false,
        region: "ru-central1",
      },
      { send },
    );

    const input = {
      body: new Uint8Array([1, 2, 3]),
      checksumSha256: "039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81",
      contentType: "application/octet-stream",
      key: "assets/opaque-id/original",
      namespace: "quarantine" as const,
    };
    await expect(storage.putImmutable(input)).resolves.toEqual({ ok: true });
    await expect(storage.putImmutable(input)).resolves.toEqual({
      error: { code: "object_already_exists" },
      ok: false,
    });

    expect(send).toHaveBeenCalledTimes(2);
    const command = send.mock.calls[0]?.[0];
    expect(command).toBeDefined();
    expect(command?.input).toMatchObject({
      Body: input.body,
      Bucket: "inside-quarantine",
      ContentType: input.contentType,
      IfNoneMatch: "*",
      Key: input.key,
      Metadata: { sha256: input.checksumSha256 },
    });
  });

  test("creates a bounded signed GET with response headers", async () => {
    const sign = vi
      .fn<(client: S3Client, command: GetObjectCommand, options: { readonly expiresIn: number }) => Promise<string>>()
      .mockResolvedValue("https://signed.example/object");
    const storage = createS3ObjectStorage(
      {
        buckets: {
          protected: "inside-protected",
          public: "inside-public",
          quarantine: "inside-quarantine",
        },
        credentials: { accessKeyId: "access", secretAccessKey: "secret" },
        endpoint: "https://storage.yandexcloud.net",
        forcePathStyle: false,
        region: "ru-central1",
      },
      {
        send: vi.fn(),
        sign,
      },
    );

    await expect(
      storage.signGet({
        contentDisposition: 'attachment; filename="guide.pdf"',
        contentType: "application/pdf",
        key: "assets/opaque-id/file",
        namespace: "protected",
        ttlSeconds: 120,
      }),
    ).resolves.toBe("https://signed.example/object");
    const signedCommand = sign.mock.calls[0]?.[1];
    expect(signedCommand?.input).toMatchObject({
      Bucket: "inside-protected",
      Key: "assets/opaque-id/file",
      ResponseContentDisposition: 'attachment; filename="guide.pdf"',
      ResponseContentType: "application/pdf",
    });
    expect(sign.mock.calls[0]?.[2]).toEqual({ expiresIn: 120 });
  });
});
