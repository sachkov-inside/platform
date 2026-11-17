import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  attachMaterialVideo,
  initMaterialVideoUpload,
  reconcileMaterialVideo,
} from "@/features/material-video/api/video-authoring.browser";
import { POST as upload } from "../../app/api/authoring/material-video-uploads/route";
import { POST as attach } from "../../app/api/authoring/material-video-attachments/route";
import { POST as reconcile } from "../../app/api/authoring/material-video-reconciliations/route";
import { realBffSession } from "../support/real-bff-session";
import { routeBrowserMutations } from "../support/mutation-operation-route";
import { useProductionRuntimeImage } from "../support/web-runtime";

const materialId = "10000000-0000-4000-8000-000000000001";
const videoId = "20000000-0000-4000-8000-000000000001";
const uploadInput = {
  access: "free",
  byteSize: 42,
  filename: "video.mp4",
  materialId,
  submissionId: videoId,
  title: "Video",
} as const;
const attachmentInput = {
  access: "closed",
  materialId,
  providerVideoId: "provider-video",
} as const;
let cleanupImage: () => void;
let requests: Request[];
let unexpectedRequests: string[];
let backendReply: { status: number; body: unknown };
let bridge: ReturnType<typeof routeBrowserMutations>;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2030-03-01T12:00:00Z"));
  cleanupImage = useProductionRuntimeImage();
  const scope = await realBffSession();
  requests = [];
  unexpectedRequests = [];
  backendReply = { status: 201, body: null };
  bridge = routeBrowserMutations(
    {
      "/api/authoring/material-video-uploads": { POST: upload },
      "/api/authoring/material-video-attachments": { POST: attach },
      "/api/authoring/material-video-reconciliations": { POST: reconcile },
    },
    "https://inside.example.test",
    {
      run: (handler) => scope(handler),
      externalFetch: (request) => {
        requests.push(request.clone());
        if (
          request.method !== "POST" ||
          ![
            "https://platform-api.example.test/authoring/materials/10000000-0000-4000-8000-000000000001/videos/uploads",
            "https://platform-api.example.test/authoring/materials/10000000-0000-4000-8000-000000000001/videos/attach",
            "https://platform-api.example.test/authoring/videos/20000000-0000-4000-8000-000000000001/reconcile",
          ].includes(request.url)
        ) {
          unexpectedRequests.push(`${request.method} ${request.url}`);
          return Promise.reject(
            new Error("Unexpected external backend request"),
          );
        }
        return Promise.resolve(
          Response.json(backendReply.body, { status: backendReply.status }),
        );
      },
    },
  );
});
afterEach(() => {
  cleanupImage();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  expect(unexpectedRequests).toEqual([]);
  expect(requests).toHaveLength(1);
  expect(requests[0]?.headers.get("authorization")).toBe(
    "Bearer trusted-token",
  );
  expect(bridge.requests).toHaveLength(1);
  expect(bridge.requests[0]?.method).toBe("POST");
  expect(bridge.statuses).toEqual([200]);
});

async function expectUploadRequest() {
  expect(requests[0]?.url).toBe(
    "https://platform-api.example.test/authoring/materials/10000000-0000-4000-8000-000000000001/videos/uploads",
  );
  expect(requests[0]?.headers.get("idempotency-key")).toBe(
    "web-video-20000000-0000-4000-8000-000000000001",
  );
  expect(await requests[0]?.json()).toEqual({
    access: "free",
    byteSize: 42,
    filename: "video.mp4",
    title: "Video",
  });
  expect(bridge.requests[0]?.url).toBe(
    "https://inside.example.test/api/authoring/material-video-uploads",
  );
}

async function expectAttachmentRequest() {
  expect(requests[0]?.url).toBe(
    "https://platform-api.example.test/authoring/materials/10000000-0000-4000-8000-000000000001/videos/attach",
  );
  expect(await requests[0]?.json()).toEqual({
    access: "closed",
    providerVideoId: "provider-video",
  });
  expect(bridge.fetch).toHaveBeenCalledWith(
    "/api/authoring/material-video-attachments",
    expect.objectContaining({
      body: JSON.stringify(attachmentInput),
      method: "POST",
    }),
  );
}

describe("Material Video authoring browser contract", () => {
  it.each(["upload_not_authorized", "upload_outcome_unknown"])(
    "preserves %s instead of suggesting a generic retry",
    async (kind) => {
      backendReply = { status: 409, body: { code: kind } };
      expect(await initMaterialVideoUpload(uploadInput)).toEqual({ kind });
      await expectUploadRequest();
    },
  );

  it("accepts the upload response the backend sends with the provider Video id", async () => {
    backendReply = {
      status: 201,
      body: {
        providerVideoId: "kinescope-1",
        uploadEndpoint: "https://uploader.example.test/v2/upload",
        video: {
          access: "free",
          materialId,
          origin: "platform_upload",
          protected: true,
          state: "uploading",
          title: "Video",
          videoId,
        },
      },
    };
    await expect(initMaterialVideoUpload(uploadInput)).resolves.toMatchObject({
      kind: "ready",
      value: { uploadEndpoint: "https://uploader.example.test/v2/upload" },
    });
    await expectUploadRequest();
  });

  it("accepts the ready Video duration returned by reconciliation", async () => {
    backendReply = {
      status: 200,
      body: {
        access: "free",
        durationSeconds: 600,
        materialId,
        origin: "platform_upload",
        protected: true,
        state: "ready",
        title: "Ready video",
        videoId,
      },
    };
    await expect(reconcileMaterialVideo({ videoId })).resolves.toEqual({
      kind: "ready",
      value: {
        access: "free",
        durationSeconds: 600,
        materialId,
        origin: "platform_upload",
        protected: true,
        state: "ready",
        title: "Ready video",
        videoId,
      },
    });
    expect(requests[0]?.url).toBe(
      "https://platform-api.example.test/authoring/videos/20000000-0000-4000-8000-000000000001/reconcile",
    );
    expect(await requests[0]?.text()).toBe("");
    expect(bridge.requests[0]?.url).toBe(
      "https://inside.example.test/api/authoring/material-video-reconciliations",
    );
  });

  it("sends the attachment as JSON and reads a real backend refusal as unavailable", async () => {
    backendReply = { status: 403, body: {} };
    await expect(attachMaterialVideo(attachmentInput)).resolves.toEqual({
      kind: "unavailable",
    });
    await expectAttachmentRequest();
  });

  it("reads the malformed backend attachment forwarded by the real BFF as unavailable", async () => {
    backendReply = { status: 201, body: { videoId } };
    await expect(attachMaterialVideo(attachmentInput)).resolves.toEqual({
      kind: "unavailable",
    });
    await expectAttachmentRequest();
  });
});
