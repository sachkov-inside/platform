import { expect, test, vi } from "vitest";
import { createPublicImageCache } from "../../src/infrastructure/object-storage/public-image-cache.js";
import type { StoredObject } from "../../src/infrastructure/object-storage/object-storage.js";

const image = (size = 4): StoredObject => ({
  body: new Uint8Array(size).fill(7),
  checksumSha256: "checksum",
  contentType: "image/webp",
  contentLength: size,
});

test("repeated and simultaneous reads share one provider request, with isolated bytes", async () => {
  const cache = createPublicImageCache();
  const load = vi.fn(() => Promise.resolve(image()));
  const [first, second] = await Promise.all([
    cache.read("image", load),
    cache.read("image", load),
  ]);
  expect(load).toHaveBeenCalledTimes(1);
  if (first === null || second === null)
    throw new Error("Missing fixture image");
  first.body[0] = 99;
  second.body[1] = 99;
  const cached = await cache.read("image", load);
  expect(cached?.body).toEqual(image().body);
  expect(load).toHaveBeenCalledTimes(1);
});

test("expires entries and evicts least recently used bytes within both bounds", async () => {
  let now = 0;
  const cache = createPublicImageCache({
    maxBytes: 8,
    maxEntries: 2,
    ttlMilliseconds: 10,
    now: () => now,
  });
  const load = vi.fn(() => Promise.resolve(image()));
  await cache.read("a", load);
  await cache.read("b", load);
  await cache.read("a", load);
  await cache.read("c", load);
  await cache.read("a", load);
  expect(load).toHaveBeenCalledTimes(3);
  await cache.read("b", load);
  expect(load).toHaveBeenCalledTimes(4);
  now = 10;
  await cache.read("b", load);
  expect(load).toHaveBeenCalledTimes(5);
  const large = vi.fn(() => Promise.resolve(image(9)));
  await cache.read("large", large);
  await cache.read("large", large);
  expect(large).toHaveBeenCalledTimes(2);
});

test("does not cache missing objects, files or provider failures", async () => {
  const cache = createPublicImageCache();
  const missing = vi.fn(() => Promise.resolve(null));
  const file = vi.fn(() =>
    Promise.resolve({
      ...image(),
      contentType: "application/pdf",
    }),
  );
  for (let i = 0; i < 2; i++) {
    await cache.read("missing", missing);
    await cache.read("file", file);
  }
  expect(missing).toHaveBeenCalledTimes(2);
  expect(file).toHaveBeenCalledTimes(2);
  await expect(
    cache.read("error", () =>
      Promise.reject(new Error("provider unavailable")),
    ),
  ).rejects.toThrow("provider unavailable");
  await expect(
    cache.read("error", () => Promise.resolve(image())),
  ).resolves.toEqual(image());
});

test("invalidating during a read prevents that read from refilling the cache", async () => {
  const cache = createPublicImageCache();
  let resolve: (value: StoredObject) => void = () => {
    throw new Error("Missing barrier");
  };
  const inFlight = cache.read(
    "image",
    () =>
      new Promise<StoredObject>((done) => {
        resolve = done;
      }),
  );
  cache.invalidate("image");
  resolve(image());
  await inFlight;
  const load = vi.fn(() => Promise.resolve(null));
  await expect(cache.read("image", load)).resolves.toBeNull();
  expect(load).toHaveBeenCalledTimes(1);
});
