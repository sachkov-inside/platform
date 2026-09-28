import { acknowledgeDataNotice } from "../../features/acknowledge-data-notice/acknowledge-data-notice.js";
import { beginRepositoryConnection } from "../../features/begin-repository-connection/begin-repository-connection.js";
import { completeRepositoryConnection } from "../../features/complete-repository-connection/complete-repository-connection.js";
import { disconnectRepository } from "../../features/disconnect-repository/disconnect-repository.js";
import { linkRepository } from "../../features/link-repository/link-repository.js";
import { listLinkableRepositories } from "../../features/list-linkable-repositories/list-linkable-repositories.js";
import { listRepositoryLinks } from "../../features/list-repository-links/list-repository-links.js";
import { readParticipantState } from "../../features/read-participant-state/read-participant-state.js";
import type { CourseAssistantDependencies } from "../../shared/course-assistant-dependencies.js";

/**
 * Помощник курса (#786): прототип за настройкой `COURSE_ASSISTANT_ENABLED` и allowlist Account.
 * Каждая операция сначала решает, открыт ли помощник этому Account; закрытый помощник отвечает
 * `unavailable` и ничего не читает.
 */
export class CourseAssistant {
  constructor(private readonly dependencies: CourseAssistantDependencies) {}

  readParticipantState(query: { readonly accountId: string }) {
    return readParticipantState(this.dependencies, query);
  }
  acknowledgeDataNotice(command: {
    readonly accountId: string;
    readonly noticeVersion: string;
  }) {
    return acknowledgeDataNotice(this.dependencies, command);
  }
  beginRepositoryConnection(command: { readonly accountId: string }) {
    return beginRepositoryConnection(this.dependencies, command);
  }
  completeRepositoryConnection(command: {
    readonly accountId: string;
    readonly state: string;
    readonly code: string;
    readonly installationId: number;
  }) {
    return completeRepositoryConnection(this.dependencies, command);
  }
  listLinkableRepositories(query: { readonly accountId: string }) {
    return listLinkableRepositories(this.dependencies, query);
  }
  linkRepository(command: {
    readonly accountId: string;
    readonly installationId: number;
    readonly repositoryId: number;
  }) {
    return linkRepository(this.dependencies, command);
  }
  disconnectRepository(command: { readonly accountId: string }) {
    return disconnectRepository(this.dependencies, command);
  }
  listRepositoryLinks(query: { readonly accountId: string }) {
    return listRepositoryLinks(this.dependencies, query);
  }
}
