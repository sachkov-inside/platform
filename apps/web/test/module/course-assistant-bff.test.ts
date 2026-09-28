import { beforeEach, expect, it, vi } from "vitest";
const fakes = vi.hoisted(() => ({
  token: vi.fn(),
  complete: vi.fn(),
  link: vi.fn(),
  participant: vi.fn(),
  SessionUnavailable: class extends Error {},
}));
vi.mock("@/shared/api/backend/index.server", () => ({
  requestCompleteCourseAssistantRepositoryConnection: fakes.complete,
  requestLinkCourseAssistantRepository: fakes.link,
  requestCourseAssistantParticipant: fakes.participant,
}));
vi.mock("@/shared/auth/platform-access-token.server", () => ({
  getPlatformAccessToken: fakes.token,
  LogtoSessionUnavailableError: fakes.SessionUnavailable,
}));
vi.mock("@/shared/auth/logto-bff-config.server", () => ({
  readLogtoBffConfig: () => ({ baseUrl: "https://inside.example.test" }),
}));
import {
  handleCourseAssistantGitHubCallback,
  handleLinkCourseAssistantRepository,
  loadCourseAssistantParticipant,
} from "@/features/course-assistant-access.server";

const state = "s".repeat(43);
const repository = {
  id: 101,
  fullName: "learner/agent-course",
  htmlUrl: "https://github.com/learner/agent-course",
};

function callback(query: string) {
  return new Request(
    `https://inside.example.test/api/account/course-assistant/github/callback?${query}`,
  );
}

function outcomeOf(response: Response): string | null {
  expect(response.status).toBe(303);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  const location = new URL(response.headers.get("location") ?? "");
  expect(location.origin + location.pathname).toBe(
    "https://inside.example.test/account/course-assistant",
  );
  return location.searchParams.get("connection");
}

beforeEach(() => {
  vi.clearAllMocks();
  fakes.token.mockResolvedValue("trusted-token");
});

it("передаёт возврат из GitHub backend и уводит код авторизации из адреса", async () => {
  fakes.complete.mockResolvedValue({
    ok: true,
    body: {
      repositoryLink: {
        installationId: 7001,
        repository,
        connectedAt: "2026-09-28T10:00:00.000Z",
        access: "available",
      },
      repositories: [{ installationId: 7001, repository }],
    },
    response: new Response(),
  });

  const response = await handleCourseAssistantGitHubCallback(
    callback(
      `code=abc&installation_id=7001&setup_action=install&state=${state}`,
    ),
  );

  expect(outcomeOf(response)).toBe("connected");
  expect(fakes.complete).toHaveBeenCalledWith(
    { state, code: "abc", installationId: 7001 },
    "trusted-token",
  );
});

it("просит выбрать репозиторий, когда установка открывает несколько", async () => {
  fakes.complete.mockResolvedValue({
    ok: true,
    body: { repositoryLink: null, repositories: [] },
    response: new Response(),
  });

  expect(
    outcomeOf(
      await handleCourseAssistantGitHubCallback(
        callback(`code=abc&installation_id=7001&state=${state}`),
      ),
    ),
  ).toBe("choose_repository");
});

it("называет отказ backend и не доверяет неполному возврату", async () => {
  fakes.complete.mockResolvedValue({
    ok: false,
    problem: { code: "installation_not_owned" },
    response: new Response(null, { status: 403 }),
  });
  expect(
    outcomeOf(
      await handleCourseAssistantGitHubCallback(
        callback(`code=abc&installation_id=7001&state=${state}`),
      ),
    ),
  ).toBe("installation_not_owned");

  expect(
    outcomeOf(
      await handleCourseAssistantGitHubCallback(
        callback(`installation_id=7001&state=${state}`),
      ),
    ),
  ).toBe("invalid_connection");
  expect(
    outcomeOf(
      await handleCourseAssistantGitHubCallback(
        callback(`code=abc&installation_id=7001&setup_action=request`),
      ),
    ),
  ).toBe("request_pending");
  expect(fakes.complete).toHaveBeenCalledOnce();
});

it("сообщает о закончившейся сессии вместо ошибки", async () => {
  fakes.token.mockRejectedValue(new fakes.SessionUnavailable());

  expect(
    outcomeOf(
      await handleCourseAssistantGitHubCallback(
        callback(`code=abc&installation_id=7001&state=${state}`),
      ),
    ),
  ).toBe("session_expired");
  expect(fakes.complete).not.toHaveBeenCalled();
});

it("отклоняет смену репозитория с чужого сайта", async () => {
  const body = new FormData();
  body.set("installationId", "7001");
  body.set("repositoryId", "101");

  const response = await handleLinkCourseAssistantRepository(
    new Request(
      "https://inside.example.test/api/account/course-assistant/repository-link",
      { body, headers: { origin: "https://evil.example.test" }, method: "PUT" },
    ),
  );

  expect(response.status).toBe(403);
  expect(fakes.link).not.toHaveBeenCalled();
});

it("закрытый помощник для страницы не существует", async () => {
  fakes.participant.mockResolvedValue({
    ok: false,
    problem: { code: "course_assistant_unavailable" },
    response: new Response(null, { status: 404 }),
  });

  await expect(
    loadCourseAssistantParticipant("trusted-token"),
  ).resolves.toEqual({ kind: "unavailable" });
});
