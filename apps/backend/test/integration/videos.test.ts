import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

import {
  assembleVideoDeletionMaintenance,
  assembleVideos,
  requestVideoDeletion,
  type ProviderVideo,
  type VideoProvider,
} from "../../src/modules/videos/index.js";
import { createMigratedTestDatabase, type TestDatabase } from "./setup/test-database.js";

const unusedDelete: VideoProvider["delete"] = () =>
  Promise.reject(new Error("unused"));

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
      delete: unusedDelete,
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
      durationSeconds: 600,
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
    await expect(
      videos.loadPresentation({
        materialId,
        videoId: initialized.value.video.videoId,
      }),
    ).resolves.toMatchObject({
      ok: true,
      value: { durationSeconds: 600, state: "ready" },
    });
    await expect(
      videos.loadReadyDurations([initialized.value.video.videoId]),
    ).resolves.toEqual({
      ok: true,
      value: [
        { durationSeconds: 600, videoId: initialized.value.video.videoId },
      ],
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
    providerAvailable = true;
    await expect(videos.reconcile({ actor, videoId: initialized.value.video.videoId }))
      .resolves.toMatchObject({ ok: true, value: { state: "ready" } });
    await expect(database.prisma.videoWebhookInbox.count({
      where: { providerVideoId, reconciledAt: null },
    })).resolves.toBe(0);
  });

  test("maps an unknown authoritative provider status to a visible failed state", async () => {
    const providerVideoId = randomUUID();
    const provider: VideoProvider = {
      delete: unusedDelete,
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

  test("records an ambiguous upload init before provider I/O and never repeats it", async () => {
    let initCalls = 0;
    const videos = assembleVideos({
      canManage: () => Promise.resolve(true),
      prisma: database.prisma,
      provider: {
        delete: unusedDelete,
        initUpload: () => {
          initCalls += 1;
          return Promise.reject(new Error("timeout after an unknown provider outcome"));
        },
        find: () => Promise.reject(new Error("unused")),
      },
      projects: { free: "public-project", membership: "member-project" },
    });
    const input = {
      access: "free" as const,
      actor: randomUUID(),
      byteSize: 4_096,
      filename: "ambiguous.mp4",
      idempotencyKey: "ambiguous-upload",
      materialId: randomUUID(),
      title: "Ambiguous upload",
    };

    await expect(videos.initUpload(input)).resolves.toEqual({
      error: { code: "dependency_unavailable", retryable: true },
      ok: false,
    });
    await expect(videos.initUpload(input)).resolves.toEqual({
      error: { code: "upload_outcome_unknown" },
      ok: false,
    });
    await expect(videos.initUpload({
      ...input,
      idempotencyKey: "ambiguous-upload-new-browser-submission",
    })).resolves.toEqual({
      error: { code: "upload_outcome_unknown" },
      ok: false,
    });
    expect(initCalls).toBe(1);
    await expect(database.prisma.videoUploadAttempt.findFirstOrThrow({
      where: {
        createdBy: input.actor,
        idempotencyKey: input.idempotencyKey,
        materialId: input.materialId,
      },
    })).resolves.toMatchObject({
      failureCode: "provider_outcome_unknown",
      status: "unknown",
      uploadEndpoint: null,
      videoId: null,
    });
  });

  test("keeps an early webhook pending and reconciles it after the local Video exists", async () => {
    const providerVideoId = `early-${randomUUID()}`;
    const provider: VideoProvider = {
      delete: unusedDelete,
      initUpload: () => Promise.resolve({
        id: providerVideoId,
        uploadEndpoint: `https://uploads.example.test/${providerVideoId}`,
      }),
      find: (input) => Promise.resolve({
        embedLocator: `https://kinescope.io/embed/${providerVideoId}`,
        id: providerVideoId,
        projectId: input.projectId,
        status: "done",
        title: "Early webhook",
      }),
    };
    const videos = assembleVideos({
      canManage: () => Promise.resolve(true),
      prisma: database.prisma,
      provider,
      projects: { free: "public-project", membership: "member-project" },
    });

    await expect(videos.acceptWebhook({
      event: "media.update.status",
      providerStatus: "done",
      providerVideoId,
    })).resolves.toEqual({ ok: true, value: undefined });
    await expect(database.prisma.videoWebhookInbox.count({
      where: { providerVideoId, reconciledAt: null },
    })).resolves.toBe(1);

    const initialized = await videos.initUpload({
      access: "free",
      actor: randomUUID(),
      byteSize: 8_192,
      filename: "early.mp4",
      idempotencyKey: "early-webhook-upload",
      materialId: randomUUID(),
      title: "Early webhook",
    });
    expect(initialized.ok).toBe(true);
    if (!initialized.ok) throw new Error(initialized.error.code);
    await expect(videos.loadPlayback(initialized.value.video.videoId)).resolves.toMatchObject({
      ok: true,
      value: { providerVideoId },
    });
    await expect(database.prisma.videoWebhookInbox.count({
      where: { providerVideoId, reconciledAt: null },
    })).resolves.toBe(0);
  });

  test("reconciles a webhook that arrives while attach lookup is in flight", async () => {
    const providerVideoId = `attach-race-${randomUUID()}`;
    let releaseLookup: (() => void) | undefined;
    let markLookupStarted: (() => void) | undefined;
    const lookupStarted = new Promise<void>((resolve) => { markLookupStarted = resolve; });
    const lookupReleased = new Promise<void>((resolve) => { releaseLookup = resolve; });
    let findCalls = 0;
    const provider: VideoProvider = {
      delete: unusedDelete,
      initUpload: () => Promise.reject(new Error("unused")),
      async find(input) {
        findCalls += 1;
        if (findCalls === 1) {
          markLookupStarted?.();
          await lookupReleased;
        }
        return {
          embedLocator: `https://kinescope.io/embed/${providerVideoId}`,
          id: providerVideoId,
          projectId: input.projectId,
          status: "done",
          title: "Attach race",
        };
      },
    };
    let clockTick = 0;
    const videos = assembleVideos({
      canManage: () => Promise.resolve(true),
      clock: () => new Date(Date.UTC(2026, 8, 2, 12, 0, clockTick++)),
      prisma: database.prisma,
      provider,
      projects: { free: "public-project", membership: "member-project" },
    });
    const attaching = videos.attachExisting({
      access: "free",
      actor: randomUUID(),
      materialId: randomUUID(),
      providerVideoId,
    });

    await lookupStarted;
    await expect(videos.acceptWebhook({
      event: "media.update.status",
      providerStatus: "done",
      providerVideoId,
    })).resolves.toEqual({ ok: true, value: undefined });
    releaseLookup?.();

    await expect(attaching).resolves.toMatchObject({ ok: true, value: { state: "ready" } });
    expect(findCalls).toBe(2);
    await expect(database.prisma.videoWebhookInbox.count({
      where: { providerVideoId, reconciledAt: null },
    })).resolves.toBe(0);
  });

  test("rejects a provider response whose identity does not match the lookup", async () => {
    const provider: VideoProvider = {
      delete: unusedDelete,
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

  test("deletes a requested owned Video once and keeps late webhooks from resurrecting its tombstone", async () => {
    const deletedProviderIds: string[] = [];
    const providerVideoId = `delete-${randomUUID()}`;
    const provider: VideoProvider = {
      delete(input) {
        deletedProviderIds.push(input.id);
        return Promise.resolve({ kind: "deleted", providerRequestId: "provider-delete-1" });
      },
      find(input) {
        return Promise.resolve({
          embedLocator: `https://kinescope.io/embed/${input.id}`,
          id: input.id,
          projectId: input.projectId,
          status: "done",
          title: "Deletion target",
        });
      },
      initUpload: () => Promise.reject(new Error("unused")),
    };
    const videos = assembleVideos({
      canManage: () => Promise.resolve(true),
      prisma: database.prisma,
      provider,
      projects: { free: "public-project", membership: "member-project" },
    });
    const materialId = randomUUID();
    const video = await database.prisma.video.create({
      data: {
        access: "free",
        createdAt: new Date("2026-09-02T10:00:00.000Z"),
        createdBy: randomUUID(),
        id: randomUUID(),
        materialId,
        origin: "platform_upload",
        projectId: "public-project",
        providerEmbedLocator: `https://kinescope.io/embed/${providerVideoId}`,
        providerStatus: "done",
        providerVideoId,
        providerVisibleAt: new Date("2026-09-02T10:00:00.000Z"),
        readyAt: new Date("2026-09-02T10:00:00.000Z"),
        state: "ready",
        title: "Deletion target",
        updatedAt: new Date("2026-09-02T10:00:00.000Z"),
      },
    });
    await database.prisma.$transaction((transaction) => requestVideoDeletion(
      transaction,
      { actor: randomUUID(), materialId, videoId: video.id },
      new Date("2026-09-02T10:01:00.000Z"),
    ));
    const maintenance = assembleVideoDeletionMaintenance({
      clock: () => new Date("2026-09-02T10:02:00.000Z"),
      prisma: database.prisma,
      provider,
    });

    await expect(maintenance.process({ isReferenced: () => Promise.resolve(false) }))
      .resolves.toEqual({
        ok: true,
        value: { deferred: 0, deleted: 1, failed: 0, retried: 0 },
      });
    await expect(maintenance.process({ isReferenced: () => Promise.resolve(false) }))
      .resolves.toEqual({
        ok: true,
        value: { deferred: 0, deleted: 0, failed: 0, retried: 0 },
      });
    expect(deletedProviderIds).toEqual([providerVideoId]);
    await expect(videos.loadAuthoringPresentation({ materialId, videoId: video.id }))
      .resolves.toMatchObject({
        ok: true,
        value: { origin: "platform_upload", state: "deleted" },
      });
    await expect(videos.loadPlayback(video.id)).resolves.toEqual({
      error: { code: "video_not_ready" },
      ok: false,
    });
    await expect(videos.saveProgress({
      accountId: randomUUID(),
      durationSeconds: 60,
      positionSeconds: 10,
      videoId: video.id,
    })).resolves.toEqual({
      error: { code: "video_not_ready" },
      ok: false,
    });

    await expect(videos.acceptWebhook({
      event: "media.update.status",
      providerStatus: "done",
      providerVideoId,
    })).resolves.toEqual({ ok: true, value: undefined });
    await expect(videos.loadPresentation({ materialId, videoId: video.id }))
      .resolves.toMatchObject({
        ok: true,
        value: { state: "deleted" },
      });
  });

  test("fails closed before provider deletion when a current or published reference remains", async () => {
    const target = await seedRequestedVideo(database);
    const reportFailure = vi.fn();
    const deleteProviderVideo = vi.fn<VideoProvider["delete"]>()
      .mockResolvedValue({ kind: "deleted" });
    const maintenance = assembleVideoDeletionMaintenance({
      prisma: database.prisma,
      provider: {
        delete: deleteProviderVideo,
        find: () => Promise.reject(new Error("unused")),
      },
      reportFailure,
    });

    await expect(maintenance.process({ isReferenced: () => Promise.resolve(true) }))
      .resolves.toEqual({
        ok: true,
        value: { deferred: 0, deleted: 0, failed: 1, retried: 0 },
      });
    expect(deleteProviderVideo).not.toHaveBeenCalled();
    expect(reportFailure).toHaveBeenCalledWith({
      category: "referenced",
      operationId: target.operationId,
    });
    const videos = assembleVideos({
      canManage: () => Promise.resolve(true),
      prisma: database.prisma,
      provider: {
        delete: deleteProviderVideo,
        find: () => Promise.reject(new Error("unused")),
        initUpload: () => Promise.reject(new Error("unused")),
      },
      projects: { free: "public-project", membership: "member-project" },
    });
    await expect(videos.inspectPrimaryReference({
      access: "free",
      materialId: target.materialId,
      videoId: target.videoId,
    })).resolves.toEqual({ error: { code: "video_not_ready" }, ok: false });
    await expect(videos.loadPresentation({
      materialId: target.materialId,
      videoId: target.videoId,
    })).resolves.toMatchObject({
      ok: true,
      value: { failureCode: "referenced", state: "delete_failed" },
    });
    await expect(videos.retryDeletion({
      actor: randomUUID(),
      videoId: target.videoId,
    })).resolves.toMatchObject({
      ok: true,
      value: { state: "deletion_requested" },
    });
    await expect(maintenance.process({ isReferenced: () => Promise.resolve(false) }))
      .resolves.toMatchObject({ ok: true, value: { deleted: 1 } });
    expect(deleteProviderVideo).toHaveBeenCalledOnce();
  });

  test("waits for an authoritative terminal provider state before DELETE", async () => {
    const target = await seedRequestedVideo(database, { providerStatus: "processing" });
    let currentTime = new Date("2026-09-02T11:00:00.000Z");
    let remoteStatus = "processing";
    const deleteProviderVideo = vi.fn<VideoProvider["delete"]>()
      .mockResolvedValue({ kind: "deleted" });
    const maintenance = assembleVideoDeletionMaintenance({
      clock: () => currentTime,
      prisma: database.prisma,
      provider: {
        delete: deleteProviderVideo,
        find: () => Promise.resolve({
          embedLocator: remoteStatus === "done"
            ? `https://kinescope.io/embed/${target.providerVideoId}`
            : null,
          id: target.providerVideoId,
          projectId: "public-project",
          status: remoteStatus,
          title: "Active deletion target",
        }),
      },
    });

    await expect(maintenance.process({ isReferenced: () => Promise.resolve(false) }))
      .resolves.toMatchObject({ ok: true, value: { deferred: 1, deleted: 0 } });
    expect(deleteProviderVideo).not.toHaveBeenCalled();
    remoteStatus = "done";
    currentTime = new Date("2026-09-02T11:00:31.000Z");
    await maintenance.process({ isReferenced: () => Promise.resolve(false) });
    expect(deleteProviderVideo).not.toHaveBeenCalled();
    await expect(maintenance.process({ isReferenced: () => Promise.resolve(false) }))
      .resolves.toMatchObject({ ok: true, value: { deferred: 0, deleted: 1 } });
    expect(deleteProviderVideo).toHaveBeenCalledOnce();
  });

  test("reschedules active uploads so they cannot starve later terminal deletions", async () => {
    const activeTargets = await Promise.all(
      Array.from({ length: 25 }, () =>
        seedRequestedVideo(database, { providerStatus: "processing" })),
    );
    const terminalTarget = await seedRequestedVideo(database);
    const activeOperationIds = activeTargets.map((target) => target.operationId);
    const activeVideoIds = activeTargets.map((target) => target.videoId);
    const [firstActiveOperationId] = activeOperationIds;
    if (firstActiveOperationId === undefined) throw new Error("missing active deletion target");
    await database.prisma.videoDeletionOperation.updateMany({
      data: {
        nextAttemptAt: new Date("2026-09-02T09:00:00.000Z"),
        requestedAt: new Date("2026-09-02T09:00:00.000Z"),
      },
      where: { id: { in: activeOperationIds } },
    });
    await database.prisma.videoDeletionOperation.update({
      data: {
        nextAttemptAt: new Date("2026-09-02T09:01:00.000Z"),
        requestedAt: new Date("2026-09-02T09:01:00.000Z"),
      },
      where: { id: terminalTarget.operationId },
    });
    const deleteProviderVideo = vi.fn<VideoProvider["delete"]>()
      .mockResolvedValue({ kind: "deleted" });
    const maintenance = assembleVideoDeletionMaintenance({
      clock: () => new Date("2026-09-02T12:00:00.000Z"),
      prisma: database.prisma,
      provider: {
        delete: deleteProviderVideo,
        find: ({ id, projectId }) => Promise.resolve({
          embedLocator: null,
          id,
          projectId,
          status: "processing",
          title: "Active deletion target",
        }),
      },
    });

    await expect(maintenance.process({ isReferenced: () => Promise.resolve(false) }))
      .resolves.toEqual({
        ok: true,
        value: { deferred: 25, deleted: 0, failed: 0, retried: 0 },
      });
    await expect(maintenance.process({ isReferenced: () => Promise.resolve(false) }))
      .resolves.toEqual({
        ok: true,
        value: { deferred: 0, deleted: 1, failed: 0, retried: 0 },
      });
    expect(deleteProviderVideo).toHaveBeenCalledOnce();
    expect(deleteProviderVideo).toHaveBeenCalledWith({ id: terminalTarget.providerVideoId });
    await expect(database.prisma.videoDeletionOperation.findUniqueOrThrow({
      where: { id: firstActiveOperationId },
    })).resolves.toMatchObject({
      nextAttemptAt: new Date("2026-09-02T12:00:30.000Z"),
      state: "deletion_requested",
    });

    await database.prisma.$transaction([
      database.prisma.videoDeletionOperation.updateMany({
        data: { lastErrorCategory: "test_cleanup", state: "delete_failed" },
        where: { id: { in: activeOperationIds } },
      }),
      database.prisma.video.updateMany({
        data: { failureCode: "test_cleanup", state: "delete_failed" },
        where: { id: { in: activeVideoIds } },
      }),
    ]);
  });

  test("converges a trusted 404 but fails an unverified 404 for operator investigation", async () => {
    const trusted = await seedRequestedVideo(database);
    const unverified = await seedRequestedVideo(database, { providerVisibleAt: null });
    const maintenance = assembleVideoDeletionMaintenance({
      prisma: database.prisma,
      provider: {
        delete: () => Promise.resolve({ kind: "not_found" }),
        find: () => Promise.reject(new Error("unused")),
      },
    });

    await expect(maintenance.process({ isReferenced: () => Promise.resolve(false) }))
      .resolves.toEqual({
        ok: true,
        value: { deferred: 0, deleted: 1, failed: 1, retried: 0 },
      });
    await expect(database.prisma.video.findUniqueOrThrow({ where: { id: trusted.videoId } }))
      .resolves.toMatchObject({ state: "deleted" });
    await expect(database.prisma.video.findUniqueOrThrow({ where: { id: unverified.videoId } }))
      .resolves.toMatchObject({
        failureCode: "provider_not_found_unverified",
        state: "delete_failed",
      });
  });

  test("retries a transient provider failure with bounded backoff and the same operation", async () => {
    const target = await seedRequestedVideo(database);
    let currentTime = new Date("2026-09-02T12:00:00.000Z");
    const deleteProviderVideo = vi.fn<VideoProvider["delete"]>()
      .mockResolvedValueOnce({ category: "timeout", kind: "retryable_failure" })
      .mockResolvedValueOnce({ kind: "deleted" });
    const maintenance = assembleVideoDeletionMaintenance({
      clock: () => currentTime,
      prisma: database.prisma,
      provider: {
        delete: deleteProviderVideo,
        find: () => Promise.reject(new Error("unused")),
      },
      random: () => 0,
    });
    const before = await database.prisma.videoDeletionOperation.findUniqueOrThrow({
      where: { videoId: target.videoId },
    });

    await expect(maintenance.process({ isReferenced: () => Promise.resolve(false) }))
      .resolves.toMatchObject({ ok: true, value: { retried: 1 } });
    await expect(maintenance.process({ isReferenced: () => Promise.resolve(false) }))
      .resolves.toMatchObject({ ok: true, value: { deleted: 0, retried: 0 } });
    currentTime = new Date("2026-09-02T12:00:31.000Z");
    await expect(maintenance.process({ isReferenced: () => Promise.resolve(false) }))
      .resolves.toMatchObject({ ok: true, value: { deleted: 1 } });
    const after = await database.prisma.videoDeletionOperation.findUniqueOrThrow({
      where: { videoId: target.videoId },
    });
    expect(after.id).toBe(before.id);
    expect(after.attempts).toBe(2);
    expect(deleteProviderVideo).toHaveBeenCalledTimes(2);
  });

  test("ignores a stale worker result after a reclaimed claim has completed deletion", async () => {
    const target = await seedRequestedVideo(database);
    let resolveStaleAttempt: ((outcome: Awaited<ReturnType<VideoProvider["delete"]>>) => void)
      | undefined;
    const deleteProviderVideo = vi.fn<VideoProvider["delete"]>()
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveStaleAttempt = resolve;
      }))
      .mockResolvedValueOnce({ kind: "deleted", providerRequestId: "winning-request" });
    let currentTime = new Date("2026-09-02T12:00:00.000Z");
    const maintenance = assembleVideoDeletionMaintenance({
      clock: () => currentTime,
      prisma: database.prisma,
      provider: {
        delete: deleteProviderVideo,
        find: () => Promise.reject(new Error("unused")),
      },
    });

    const staleProcess = maintenance.process({ isReferenced: () => Promise.resolve(false) });
    await vi.waitFor(() => {
      expect(deleteProviderVideo).toHaveBeenCalledTimes(1);
    });
    currentTime = new Date("2026-09-02T12:06:00.000Z");
    await expect(maintenance.process({ isReferenced: () => Promise.resolve(false) }))
      .resolves.toMatchObject({ ok: true, value: { deleted: 1 } });
    resolveStaleAttempt?.({ category: "timeout", kind: "retryable_failure" });
    await expect(staleProcess).resolves.toMatchObject({
      ok: true,
      value: { deleted: 0, failed: 0, retried: 0 },
    });

    await expect(database.prisma.videoDeletionOperation.findUniqueOrThrow({
      where: { id: target.operationId },
    })).resolves.toMatchObject({
      providerRequestId: "winning-request",
      state: "deleted",
    });
    await expect(database.prisma.video.findUniqueOrThrow({ where: { id: target.videoId } }))
      .resolves.toMatchObject({ state: "deleted" });
  });

  test("records terminal provider categories without removing the local audit row", async () => {
    const target = await seedRequestedVideo(database);
    const reportFailure = vi.fn();
    const maintenance = assembleVideoDeletionMaintenance({
      prisma: database.prisma,
      provider: {
        delete: () => Promise.resolve({
          category: "permission",
          kind: "terminal_failure",
          providerRequestId: "permission-request",
        }),
        find: () => Promise.reject(new Error("unused")),
      },
      reportFailure,
    });

    await expect(maintenance.process({ isReferenced: () => Promise.resolve(false) }))
      .resolves.toMatchObject({ ok: true, value: { failed: 1 } });
    await expect(database.prisma.videoDeletionOperation.findUniqueOrThrow({
      where: { videoId: target.videoId },
    })).resolves.toMatchObject({
      lastErrorCategory: "permission",
      providerRequestId: "permission-request",
      state: "delete_failed",
    });
    await expect(database.prisma.video.findUniqueOrThrow({ where: { id: target.videoId } }))
      .resolves.toMatchObject({
        providerEmbedLocator: `https://kinescope.io/embed/${target.providerVideoId}`,
        state: "delete_failed",
      });
    expect(reportFailure).toHaveBeenCalledWith({
      category: "permission",
      operationId: target.operationId,
      providerRequestId: "permission-request",
    });
  });
});

async function seedRequestedVideo(
  database: TestDatabase,
  overrides: {
    readonly providerStatus?: string;
    readonly providerVisibleAt?: Date | null;
  } = {},
) {
  const materialId = randomUUID();
  const providerVideoId = `delete-fixture-${randomUUID()}`;
  const videoId = randomUUID();
  const createdAt = new Date("2026-09-02T09:00:00.000Z");
  await database.prisma.video.create({
    data: {
      access: "free",
      createdAt,
      createdBy: randomUUID(),
      id: videoId,
      materialId,
      origin: "platform_upload",
      projectId: "public-project",
      providerEmbedLocator: `https://kinescope.io/embed/${providerVideoId}`,
      providerStatus: overrides.providerStatus ?? "done",
      providerVideoId,
      providerVisibleAt: overrides.providerVisibleAt === undefined
        ? createdAt
        : overrides.providerVisibleAt,
      readyAt: createdAt,
      state: "ready",
      title: "Deletion fixture",
      updatedAt: createdAt,
    },
  });
  const deletion = await database.prisma.$transaction((transaction) => requestVideoDeletion(
    transaction,
    { actor: randomUUID(), materialId, videoId },
    new Date("2026-09-02T09:01:00.000Z"),
  ));
  if (!deletion.ok) throw new Error(deletion.code);
  return { materialId, operationId: deletion.operationId, providerVideoId, videoId };
}
