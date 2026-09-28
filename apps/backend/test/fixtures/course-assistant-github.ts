import type {
  GitHubApp,
  GitHubRepository,
} from "../../src/modules/course-assistant/index.js";

interface Installation {
  readonly login: string;
  readonly repositories: readonly GitHubRepository[];
  readonly writable: boolean;
}

export interface FakeGitHubApp extends GitHubApp {
  install(
    installationId: number,
    installation: {
      readonly login: string;
      readonly repositories: readonly GitHubRepository[];
      readonly writable?: boolean;
    },
  ): void;
  revoke(installationId: number): void;
  /** Код авторизации пользователя GitHub; действует один раз, как настоящий. */
  authorize(login: string): string;
  /** Следующие вызовы отвечают сбоем, пока не выполнится `install`. */
  failNextCalls(): void;
}

/** Двойник GitHub App: установки, коды авторизации, отзыв и сбой поставщика. */
export function fakeGitHubApp(): FakeGitHubApp {
  const installations = new Map<number, Installation>();
  const codes = new Map<string, string>();
  let failing = false;
  let issued = 0;
  return {
    installationUrl: (state) =>
      `https://github.example.test/apps/inside-course/installations/new?state=${state}`,
    verifyInstallationOwner({ code, installationId }) {
      if (failing)
        return Promise.resolve({ ok: false, reason: "dependency_unavailable" });
      const login = codes.get(code);
      codes.delete(code);
      if (login === undefined)
        return Promise.resolve({ ok: false, reason: "invalid_code" });
      const installation = installations.get(installationId);
      if (installation?.login !== login)
        return Promise.resolve({ ok: false, reason: "not_owner" });
      if (installation.writable)
        return Promise.resolve({ ok: false, reason: "write_access_requested" });
      return Promise.resolve({ ok: true, login });
    },
    listInstallationRepositories(installationId) {
      if (failing)
        return Promise.resolve({ ok: false, reason: "dependency_unavailable" });
      const installation = installations.get(installationId);
      return Promise.resolve(
        installation === undefined
          ? { ok: false, reason: "revoked" }
          : { ok: true, repositories: installation.repositories },
      );
    },
    install(installationId, installation) {
      failing = false;
      installations.set(installationId, {
        login: installation.login,
        repositories: installation.repositories,
        writable: installation.writable ?? false,
      });
    },
    revoke(installationId) {
      installations.delete(installationId);
    },
    authorize(login) {
      issued += 1;
      const code = `code-${issued}`;
      codes.set(code, login);
      return code;
    },
    failNextCalls() {
      failing = true;
    },
  };
}
