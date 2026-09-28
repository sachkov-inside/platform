/** Репозиторий, который установка GitHub App курса открывает на чтение. */
export interface GitHubRepository {
  readonly id: number;
  readonly fullName: string;
  readonly htmlUrl: string;
}

/**
 * GitHub App курса: установка участником, проверка, что установка принадлежит ему, и чтение
 * репозиториев, которые она открывает. Права приложения — только чтение metadata, contents и pull
 * requests; установку с правом записи модуль не принимает.
 */
export interface GitHubApp {
  /** Адрес установки приложения; `state` возвращается в callback без изменений. */
  installationUrl(state: string): string;
  /**
   * Подтверждает по коду авторизации участника, что установка доступна именно ему, и что она
   * не просит больше, чем чтение.
   */
  verifyInstallationOwner(input: {
    readonly code: string;
    readonly installationId: number;
  }): Promise<
    | { readonly ok: true; readonly login: string }
    | {
        readonly ok: false;
        readonly reason:
          | "invalid_code"
          | "not_owner"
          | "write_access_requested"
          | "dependency_unavailable";
      }
  >;
  /** Репозитории установки; удалённая или приостановленная установка — `revoked`. */
  listInstallationRepositories(
    installationId: number,
  ): Promise<
    | { readonly ok: true; readonly repositories: readonly GitHubRepository[] }
    | {
        readonly ok: false;
        readonly reason: "revoked" | "dependency_unavailable";
      }
  >;
}
