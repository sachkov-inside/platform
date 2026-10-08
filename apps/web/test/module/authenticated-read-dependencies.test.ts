import { beforeEach, expect, it, vi } from "vitest";

const fakes = vi.hoisted(() => ({
  materials: vi.fn(),
  pin: vi.fn(),
  communications: vi.fn(),
}));
vi.mock("@/shared/auth/session-adapter.server", () => ({
  sessionAdapter: { accessToken: () => Promise.resolve("reader-token") },
  LogtoSessionUnavailableError: class extends Error {},
}));
vi.mock("@/shared/api/backend/index.server", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  requestAuthoringMaterials: fakes.materials,
  requestAuthoringHomePin: fakes.pin,
  requestCommunications: fakes.communications,
}));
import { BackendConnectionError } from "@/shared/api/backend/index.server";
import { handleAuthoringMaterialsRequest } from "@/_pages/authoring-materials/api/authoring-materials-route.server";
import { handleHomePinReadRequest } from "@/features/series-order/api/home-pin-route.server";
import { handleSavedPostList } from "@/_pages/communications/api/communications.server";
const request = () => new Request("https://inside.example.test/api/read");
const capabilities = [
  [
    "authoring materials",
    fakes.materials,
    () => handleAuthoringMaterialsRequest(request()),
  ],
  ["home pin", fakes.pin, handleHomePinReadRequest],
  [
    "communications",
    fakes.communications,
    () => handleSavedPostList(request()),
  ],
] as const;
beforeEach(() => vi.clearAllMocks());

it.each(capabilities)(
  "%s reports a failed backend as 503 rather than a successful read",
  async (_name, backend, read) => {
    backend.mockResolvedValue({
      ok: false,
      problem: { code: "dependency_unavailable" },
      response: new Response(null, { status: 503 }),
    });
    const response = await read();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ kind: "dependency_unavailable" });
  },
);

it.each(capabilities)(
  "%s reports a lost backend connection with the same protocol",
  async (_name, backend, read) => {
    backend.mockRejectedValue(
      new BackendConnectionError("unavailable", "offline"),
    );
    const response = await read();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ kind: "dependency_unavailable" });
  },
);

it.each(capabilities)(
  "%s reports a backend-rejected session as 401",
  async (_name, backend, read) => {
    backend.mockResolvedValue({
      ok: false,
      problem: { code: "authentication_required" },
      response: new Response(null, { status: 401 }),
    });
    const response = await read();
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ kind: "authentication_required" });
  },
);
