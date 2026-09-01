import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { assembleVideos, type ProviderVideo, type VideoProvider } from "../../src/modules/videos/index.js";
import { createMigratedTestDatabase, type TestDatabase } from "./setup/test-database.js";

describe("Videos against PostgreSQL and provider test adapter", () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await createMigratedTestDatabase();
  });

  afterAll(async () => {
    await database.dispose();
  });

  test("keeps upload identity stable and reconciles webhook hints authoritatively", async () => {
    const remote = new Map<string, ProviderVideo>();
    let providerAvailable = true;
    const provider: VideoProvider = {
      initUpload(input) {
        const id = randomUUID();
        remote.set(id, {
          embedLocator: null,
          id,
          projectId: input.projectId,
          status: "uploading",
          title: input.title,
        });
        return Promise.resolve({ id, uploadEndpoint: `https://uploads.example.test/${id}` });
      },
      find(input) {
        if (!providerAvailable) return Promise.reject(new Error("provider unavailable"));
        return Promise.resolve(remote.get(input.id) ?? null);
      },
    };
    const videos = assembleVideos({
      canManage: () => Promise.resolve(true),
      prisma: database.prisma,
      provider,
      projects: { free: "public-project", membership: "member-project" },
    });
    const actor = randomUUID();
    const materialId = randomUUID();
    const input = {
      access: "membership" as const,
      actor,
      byteSize: 2_048,
      filename: "lesson.mp4",
      idempotencyKey: "video-upload-1",
      materialId,
      title: "Lifecycle lesson",
    };

    const initialized = await videos.initUpload(input);
    expect(initialized).toMatchObject({ ok: true, value: { video: { state: "uploading" } } });
    if (!initialized.ok) throw new Error(initialized.error.code);
    await expect(videos.initUpload(input)).resolves.toEqual(initialized);
    await expect(videos.initUpload({ ...input, title: "Different request" })).resolves.toEqual({
      error: { code: "idempotency_key_reused" },
      ok: false,
    });

    const providerVideoId = (await database.prisma.video.findUniqueOrThrow({
      where: { id: initialized.value.video.videoId },
    })).providerVideoId;
    remote.set(providerVideoId, {
      embedLocator: null,
      id: providerVideoId,
      projectId: "member-project",
      status: "processing",
      title: "Lifecycle lesson",
    });
    await expect(videos.reconcile({ actor, videoId: initialized.value.video.videoId }))
      .resolves.toMatchObject({ ok: true, value: { state: "processing" } });

    remote.set(providerVideoId, {
      embedLocator: `https://kinescope.io/embed/${providerVideoId}`,
      id: providerVideoId,
      projectId: "member-project",
      status: "done",
      title: "Lifecycle lesson",
    });
    await expect(videos.acceptWebhook({
      event: "media.update.status",
      providerStatus: "error",
      providerVideoId,
    })).resolves.toEqual({ ok: true, value: undefined });
    await expect(videos.acceptWebhook({
      event: "media.update.status",
      providerStatus: "processing",
      providerVideoId,
    })).resolves.toEqual({ ok: true, value: undefined });
    await expect(videos.loadPlayback(initialized.value.video.videoId)).resolves.toMatchObject({
      ok: true,
      value: { access: "membership", providerVideoId },
    });
    await expect(videos.loadAccessFacts([initialized.value.video.videoId])).resolves.toEqual({
      ok: true,
      value: [{ access: "membership", materialId, videoId: initialized.value.video.videoId }],
    });
    await expect(videos.inspectPrimaryReference({
      access: "free",
      materialId,
      videoId: initialized.value.video.videoId,
    })).resolves.toEqual({ ok: false, error: { code: "provider_mismatch" } });

    const accountId = randomUUID();
    await expect(videos.saveProgress({
      accountId,
      durationSeconds: 600,
      positionSeconds: 123,
      videoId: initialized.value.video.videoId,
    })).resolves.toEqual({ ok: true, value: undefined });
    await expect(videos.loadProgress({ accountId, videoId: initialized.value.video.videoId }))
      .resolves.toEqual({ ok: true, value: { positionSeconds: 123 } });
    providerAvailable = false;
    await expect(videos.acceptWebhook({
      event: "media.update.status",
      providerStatus: "done",
      providerVideoId,
    })).resolves.toEqual({
      error: { code: "dependency_unavailable", retryable: true },
      ok: false,
    });
    await expect(database.prisma.videoWebhookInbox.count({ where: { providerVideoId } }))
      .resolves.toBe(3);
    await expect(database.prisma.videoWebhookInbox.count({
      where: { providerVideoId, reconciledAt: null },
    })).resolves.toBe(1);
  });

  test("maps an unknown authoritative provider status to a visible failed state", async () => {
    const providerVideoId = randomUUID();
    const provider: VideoProvider = {
      initUpload: () => Promise.reject(new Error("unused")),
      find: () => Promise.resolve({
        embedLocator: null,
        id: providerVideoId,
        projectId: "public-project",
        status: "future-provider-state",
        title: "Unknown state",
      }),
    };
    const videos = assembleVideos({
      canManage: () => Promise.resolve(true),
      prisma: database.prisma,
      provider,
      projects: { free: "public-project", membership: "member-project" },
    });
    await expect(videos.attachExisting({
      access: "free",
      actor: randomUUID(),
      materialId: randomUUID(),
      providerVideoId,
    })).resolves.toMatchObject({
      ok: true,
      value: { failureCode: "unknown_provider_status", state: "failed" },
    });
  });

  test("rejects a provider response whose identity does not match the lookup", async () => {
    const provider: VideoProvider = {
      initUpload: () => Promise.reject(new Error("unused")),
      find: () => Promise.resolve({
        embedLocator: "https://kinescope.io/embed/different-video",
        id: "different-video",
        projectId: "public-project",
        status: "done",
        title: "Wrong identity",
      }),
    };
    const videos = assembleVideos({
      canManage: () => Promise.resolve(true),
      prisma: database.prisma,
      provider,
      projects: { free: "public-project", membership: "member-project" },
    });
    await expect(videos.attachExisting({
      access: "free",
      actor: randomUUID(),
      materialId: randomUUID(),
      providerVideoId: "requested-video",
    })).resolves.toEqual({ error: { code: "provider_mismatch" }, ok: false });
  });
});
